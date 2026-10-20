import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';

import { hashPassword } from './password.util';
import { hashSessionToken } from './session-token.util';

const { AuthServiceService } = await import('./auth-service.service');

jest.setTimeout(30000);

describe('Customer login and session integration', () => {
  let db: any;
  let service: InstanceType<typeof AuthServiceService>;

  const customerIds: string[] = [];
  const password = 'RimflexTestSessionOnly_2026_A!';

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
      throw new Error(
        'Refusing to run outside doorstep_auth_test',
      );
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

    service = new AuthServiceService(db);
  });

  afterAll(async () => {
    if (!db) return;

    try {
      for (const userId of customerIds) {
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

  async function createCustomer(verified: boolean) {
    const id = randomUUID();
    const email = `session-integration-${id}@example.test`;

    await db.orm.public.User.create({
      id,
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Session',
      lastName: 'Integration',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      ...(verified
        ? { emailVerifiedAt: Temporal.Now.instant() }
        : {}),
    });

    customerIds.push(id);

    return { id, email };
  }

  it('rejects login for an unverified customer', async () => {
    const customer = await createCustomer(false);

    await expect(
      service.loginCustomer({
        email: customer.email,
        password,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const sessions = await db.orm.public.AuthSession
      .where({ userId: customer.id })
      .all();

    expect(sessions).toHaveLength(0);
  });

  it('allows verified login and stores only the token hash', async () => {
    const customer = await createCustomer(true);

    const result = await service.loginCustomer({
      email: customer.email,
      password,
    });

    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.user.id).toBe(customer.id);

    const sessions = await db.orm.public.AuthSession
      .where({ userId: customer.id })
      .all();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(
      hashSessionToken(result.sessionToken),
    );
    expect(sessions[0].tokenHash).not.toBe(result.sessionToken);
  });

  it('rejects an incorrect password', async () => {
    const customer = await createCustomer(true);

    await expect(
      service.loginCustomer({
        email: customer.email,
        password: 'RimflexTestInvalidLogin_2026_B!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('validates an active customer session', async () => {
    const customer = await createCustomer(true);

    const login = await service.loginCustomer({
      email: customer.email,
      password,
    });

    const user = await service.validateCustomerSession(
      login.sessionToken,
    );

    expect(user.id).toBe(customer.id);
    expect(user.email).toBe(customer.email);
    expect(user.role).toBe('CUSTOMER');
  });

  it('revokes a customer session on logout', async () => {
    const customer = await createCustomer(true);

    const login = await service.loginCustomer({
      email: customer.email,
      password,
    });

    const result = await service.revokeCustomerSession(
      login.sessionToken,
    );

    expect(result.message).toBe('Logged out successfully');

    const session = await db.orm.public.AuthSession
      .where({ tokenHash: hashSessionToken(login.sessionToken) })
      .first();

    expect(session).not.toBeNull();
    expect(session.revokedAt).not.toBeNull();
  });

  it('rejects reuse of a revoked session', async () => {
    const customer = await createCustomer(true);

    const login = await service.loginCustomer({
      email: customer.email,
      password,
    });

    await service.revokeCustomerSession(login.sessionToken);

    await expect(
      service.validateCustomerSession(login.sessionToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
