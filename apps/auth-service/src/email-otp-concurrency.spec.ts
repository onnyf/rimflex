import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import { jest } from '@jest/globals';

const mockSendVerificationEmail = jest.fn<
  (recipientEmail: string, code: string) => Promise<void>
>().mockResolvedValue(undefined);

jest.unstable_mockModule('./verification-email.util', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

const { AuthServiceService } = await import('./auth-service.service');

jest.setTimeout(30000);

const previousEmailOtpSecret = process.env.EMAIL_OTP_SECRET;
process.env.EMAIL_OTP_SECRET = randomBytes(32).toString('hex');

afterAll(() => {
  if (previousEmailOtpSecret === undefined) {
    delete process.env.EMAIL_OTP_SECRET;
  } else {
    process.env.EMAIL_OTP_SECRET = previousEmailOtpSecret;
  }
});
describe('Customer email OTP resend concurrency', () => {
  let db: any;
  let service: AuthServiceService;

  const customerIds: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error('DATABASE_URL is required for integration tests');
    }

    const parsed = new URL(url);

    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.pathname !== '/doorstep_auth_test'
    ) {
      throw new Error(
        'Refusing to run integration test outside doorstep_auth_test',
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
        await db.orm.public.EmailVerificationCode
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
    const email = `otp-concurrency-${id}@example.test`;

    await db.orm.public.User.create({
      id,
      email,
      passwordHash: 'integration-test-only',
      firstName: 'OTP',
      lastName: 'Concurrency',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });

    customerIds.push(id);

    return { id, email };
  }

  it('serializes concurrent resends for the same customer', async () => {
    const customer = await createCustomer();

    const results = await Promise.allSettled([
      service.resendCustomerEmailOtp({
        email: customer.email,
      }),
      service.resendCustomerEmailOtp({
        email: customer.email,
      }),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = (rejected[0] as PromiseRejectedResult).reason;

    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(429);

    const records =
      await db.orm.public.EmailVerificationCode
        .where({ userId: customer.id })
        .all();

    expect(records).toHaveLength(1);

    expect(mockSendVerificationEmail).toHaveBeenCalledWith(
      customer.email,
      expect.stringMatching(/^[0-9]{6}$/),
    );
  });

  it('allows another customer to request an OTP', async () => {
    const customer = await createCustomer();

    await expect(
      service.resendCustomerEmailOtp({
        email: customer.email,
      }),
    ).resolves.toEqual({
      message:
        'If this account requires verification, a new code will be sent if permitted.',
    });

    const records =
      await db.orm.public.EmailVerificationCode
        .where({ userId: customer.id })
        .all();

    expect(records).toHaveLength(1);
  });

  it('rejects an immediate repeat request', async () => {
    const customer = await createCustomer();

    await service.resendCustomerEmailOtp({
      email: customer.email,
    });

    await expect(
      service.resendCustomerEmailOtp({
        email: customer.email,
      }),
    ).rejects.toMatchObject({
      status: 429,
    });

    const records =
      await db.orm.public.EmailVerificationCode
        .where({ userId: customer.id })
        .all();

    expect(records).toHaveLength(1);
  });
});
