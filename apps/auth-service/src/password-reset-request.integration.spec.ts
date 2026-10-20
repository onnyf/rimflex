import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';

import { hashPassword } from './password.util';
import { hashPasswordResetToken } from './password-reset-token.util';
import { createCustomerPasswordResetRequest } from './password-reset-request.util';

jest.setTimeout(30000);

describe('Customer password reset request integration', () => {
  let db: any;

  const customerIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error('DATABASE_URL is required');
    }

    const parsed = new URL(url);

    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.pathname !== '/doorstep_auth_test'
    ) {
      throw new Error('Refusing to run outside doorstep_auth_test');
    }

    const globalWithTemporal = globalThis as typeof globalThis & {
      Temporal?: typeof Temporal;
    };

    globalWithTemporal.Temporal ??= Temporal;

    const contractJson = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'prisma', 'contract.json'),
        'utf8',
      ),
    );

    const loadPostgres = new Function(
      'return import("@prisma/orm-postgres/runtime")',
    ) as () => Promise<typeof import('@prisma/orm-postgres/runtime')>;

    const { default: postgres } = await loadPostgres();

    db = postgres({ contractJson, url });

    await db.connect();
  });

  afterAll(async () => {
    if (!db) return;

    try {
      for (const userId of customerIds) {
        await db.orm.public.PasswordResetToken
          .where({ userId })
          .delete();

        await db.orm.public.AuthSession
          .where({ userId })
          .delete();

        await db.orm.public.User
          .where({ id: userId })
          .delete();
      }
    } finally {
      await db.close();
    }
  });

  async function createCustomer(options: {
    verified?: boolean;
    status?: 'ACTIVE' | 'SUSPENDED';
  } = {}) {
    const id = randomUUID();
    const email = `reset-request-${id}@example.test`;

    await db.orm.public.User.create({
      id,
      email,
      passwordHash: await hashPassword('RimflexRequestTest2026!'),
      firstName: 'Reset',
      lastName: 'RequestTest',
      role: 'CUSTOMER',
      status: options.status ?? 'ACTIVE',
      ...(options.verified === false
        ? {}
        : { emailVerifiedAt: Temporal.Now.instant() }),
    });

    customerIds.push(id);

    return { id, email };
  }

  it('stores only a hash for an eligible customer', async () => {
    const customer = await createCustomer();

    const token = await createCustomerPasswordResetRequest(
      db,
      customer.id,
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const records = await db.orm.public.PasswordResetToken
      .where({ userId: customer.id })
      .all();

    expect(records).toHaveLength(1);
    expect(records[0].tokenHash).toBe(hashPasswordResetToken(token!));
    expect(records[0].tokenHash).not.toBe(token);
    expect(records[0].consumedAt).toBeNull();
  });

  it('enforces the 60-second cooldown', async () => {
    const customer = await createCustomer();

    const first = await createCustomerPasswordResetRequest(
      db,
      customer.id,
    );

    const second = await createCustomerPasswordResetRequest(
      db,
      customer.id,
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const records = await db.orm.public.PasswordResetToken
      .where({ userId: customer.id })
      .all();

    expect(records).toHaveLength(1);
  });

  it('allows only one concurrent reset request', async () => {
    const customer = await createCustomer();

    const results = await Promise.all([
      createCustomerPasswordResetRequest(db, customer.id),
      createCustomerPasswordResetRequest(db, customer.id),
    ]);

    expect(results.filter((value) => value !== null)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);

    const records = await db.orm.public.PasswordResetToken
      .where({ userId: customer.id })
      .all();

    expect(records).toHaveLength(1);
  });

  it('rejects requests for unverified customers', async () => {
    const customer = await createCustomer({ verified: false });

    const token = await createCustomerPasswordResetRequest(
      db,
      customer.id,
    );

    expect(token).toBeNull();

    const records = await db.orm.public.PasswordResetToken
      .where({ userId: customer.id })
      .all();

    expect(records).toHaveLength(0);
  });

  it('rejects requests for inactive customers', async () => {
    const customer = await createCustomer({ status: 'SUSPENDED' });

    const token = await createCustomerPasswordResetRequest(
      db,
      customer.id,
    );

    expect(token).toBeNull();

    const records = await db.orm.public.PasswordResetToken
      .where({ userId: customer.id })
      .all();

    expect(records).toHaveLength(0);
  });
});
