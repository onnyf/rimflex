import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { UnauthorizedException } from '@nestjs/common';
import { AuthServiceService } from './auth-service.service';

import { finalizeCustomerPasswordReset } from './password-reset-finalize.util';
import { hashPassword, verifyPassword } from './password.util';
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  getPasswordResetExpiration,
} from './password-reset-token.util';
import {
  generateSessionToken,
  hashSessionToken,
  getSessionExpiration,
} from './session-token.util';

jest.setTimeout(30000);

describe('Customer password reset integration', () => {
  let db: any;
  const customerIds: string[] = [];
  const originalPassword = 'RimflexTestOriginalOnly_2026_C!';
  const replacementPassword = 'RimflexTestReplacementOnly_2026_D!';

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
        await db.orm.public.AuthSession
          .where({ userId })
          .delete();

        await db.orm.public.PasswordResetToken
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

  async function createCustomer() {
    const id = randomUUID();
    const email = `password-reset-integration-${id}@example.test`;

    await db.orm.public.User.create({
      id,
      email,
      passwordHash: await hashPassword(originalPassword),
      firstName: 'Password',
      lastName: 'ResetTest',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: Temporal.Now.instant(),
    });

    customerIds.push(id);

    return { id, email };
  }

  async function createResetToken(
    userId: string,
    expiresAt = getPasswordResetExpiration(),
  ) {
    const token = generatePasswordResetToken();

    await db.orm.public.PasswordResetToken.create({
      id: randomUUID(),
      userId,
      tokenHash: hashPasswordResetToken(token),
      expiresAt,
    });

    return token;
  }

  async function createSession(userId: string) {
    const token = generateSessionToken();

    await db.orm.public.AuthSession.create({
      id: randomUUID(),
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: getSessionExpiration(),
    });

    return token;
  }

  it('updates the password and revokes existing sessions', async () => {
    const customer = await createCustomer();
    const token = await createResetToken(customer.id);

    await createSession(customer.id);
    await createSession(customer.id);

    const result = await finalizeCustomerPasswordReset(
      db,
      token,
      replacementPassword,
    );

    expect(result).toBe(true);

    const user = await db.orm.public.User
      .where({ id: customer.id })
      .first();

    expect(await verifyPassword(replacementPassword, user.passwordHash))
      .toBe(true);

    expect(await verifyPassword(originalPassword, user.passwordHash))
      .toBe(false);

    const sessions = await db.orm.public.AuthSession
      .where({ userId: customer.id })
      .all();

    expect(sessions).toHaveLength(2);
    expect(sessions.every((session: any) => session.revokedAt !== null))
      .toBe(true);
  });

  it('rejects reuse of a consumed reset token', async () => {
    const customer = await createCustomer();
    const token = await createResetToken(customer.id);

    expect(
      await finalizeCustomerPasswordReset(
        db,
        token,
        replacementPassword,
      ),
    ).toBe(true);

    expect(
      await finalizeCustomerPasswordReset(
        db,
        token,
        'AnotherPassword2026!',
      ),
    ).toBe(false);
  });

  it('rejects expired reset tokens', async () => {
    const customer = await createCustomer();

    const expiredAt = Temporal.Now.instant().subtract({
      minutes: 1,
    });

    const token = await createResetToken(customer.id, expiredAt);

    expect(
      await finalizeCustomerPasswordReset(
        db,
        token,
        replacementPassword,
      ),
    ).toBe(false);

    const user = await db.orm.public.User
      .where({ id: customer.id })
      .first();

    expect(await verifyPassword(originalPassword, user.passwordHash))
      .toBe(true);
  });

  it('rejects malformed and unknown reset tokens', async () => {
    expect(
      await finalizeCustomerPasswordReset(
        db,
        'invalid',
        replacementPassword,
      ),
    ).toBe(false);

    expect(
      await finalizeCustomerPasswordReset(
        db,
        generatePasswordResetToken(),
        replacementPassword,
      ),
    ).toBe(false);
  });

  it('allows only one concurrent use of the same token', async () => {
    const customer = await createCustomer();
    const token = await createResetToken(customer.id);

    const results = await Promise.all([
      finalizeCustomerPasswordReset(
        db,
        token,
        replacementPassword,
      ),
      finalizeCustomerPasswordReset(
        db,
        token,
        'AnotherPassword2026!',
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => !value)).toHaveLength(1);
  });

  it('does not leave an old-password session active after concurrent reset', async () => {
    const customer = await createCustomer();
    const token = await createResetToken(customer.id);
    const authService = new AuthServiceService(db);

    const [loginResult, resetResult] = await Promise.allSettled([
      authService.loginCustomer({
        email: customer.email,
        password: originalPassword,
      }),
      finalizeCustomerPasswordReset(
        db,
        token,
        replacementPassword,
      ),
    ]);

    expect(resetResult.status).toBe('fulfilled');

    if (resetResult.status !== 'fulfilled') {
      throw resetResult.reason;
    }

    expect(resetResult.value).toBe(true);

    if (loginResult.status === 'rejected') {
      expect(loginResult.reason).toBeInstanceOf(UnauthorizedException);
    }

    const sessions = await db.orm.public.AuthSession
      .where({ userId: customer.id })
      .all();

    expect(sessions.every((session: any) => session.revokedAt !== null))
      .toBe(true);

    if (loginResult.status === 'fulfilled') {
      await expect(
        authService.validateCustomerSession(
          loginResult.value.sessionToken,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects old-password login after reset completion', async () => {
    const customer = await createCustomer();
    const token = await createResetToken(customer.id);
    const authService = new AuthServiceService(db);

    expect(
      await finalizeCustomerPasswordReset(
        db,
        token,
        replacementPassword,
      ),
    ).toBe(true);

    await expect(
      authService.loginCustomer({
        email: customer.email,
        password: originalPassword,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const newLogin = await authService.loginCustomer({
      email: customer.email,
      password: replacementPassword,
    });

    expect(newLogin.user.id).toBe(customer.id);

    const validated = await authService.validateCustomerSession(
      newLogin.sessionToken,
    );

    expect(validated.id).toBe(customer.id);
  });
});
