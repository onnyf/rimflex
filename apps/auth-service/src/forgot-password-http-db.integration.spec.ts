import { jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

const mockSendEmail = jest.fn<(...args: any[]) => Promise<void>>();

jest.unstable_mockModule('./password-reset-email.util', () => ({
  sendPasswordResetEmail: mockSendEmail,
}));

const { AuthServiceController } =
  await import('./auth-service.controller');

const { AuthServiceService } =
  await import('./auth-service.service');

const { DATABASE } =
  await import('./database.provider');

const { hashPasswordResetClientIp } =
  await import('./password-reset-ip-rate-limit.util');

jest.setTimeout(30000);

describe('Forgot-password HTTP to PostgreSQL integration', () => {
  let app: INestApplication | undefined;
  let db: any;
  let testIpHash: string | undefined;
  let lookupCount: (() => number) | undefined;

  const originalSecret =
    process.env.PASSWORD_RESET_IP_HASH_SECRET;

  const genericResponse = {
    message:
      'If an eligible account exists, a password reset link will be sent.',
  };

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error('DATABASE_URL is required.');
    }

    const parsed = new URL(url);

    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(
        parsed.hostname,
      ) ||
      parsed.pathname !== '/doorstep_auth_test'
    ) {
      throw new Error(
        'Refusing to run outside local doorstep_auth_test.',
      );
    }

    const globalWithTemporal =
      globalThis as typeof globalThis & {
        Temporal?: typeof Temporal;
      };

    globalWithTemporal.Temporal ??= Temporal;

    process.env.PASSWORD_RESET_IP_HASH_SECRET =
      randomBytes(32).toString('hex');

    const contractJson = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'prisma', 'contract.json'),
        'utf8',
      ),
    );

    const loadPostgres = new Function(
      'return import("@prisma/orm-postgres/runtime")',
    ) as () => Promise<
      typeof import('@prisma/orm-postgres/runtime')
    >;

    const { default: postgres } = await loadPostgres();

    db = postgres({ contractJson, url });

    await db.connect();

    const originalUserWhere =
      db.orm.public.User.where.bind(db.orm.public.User);

    let accountLookupCount = 0;

    const trackedDb = {
      ...db,
      orm: {
        ...db.orm,
        public: {
          ...db.orm.public,
          User: {
            where: (...args: any[]) => {
              accountLookupCount++;
              return originalUserWhere(...args);
            },
          },
        },
      },
    };

    lookupCount = () => accountLookupCount;

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthServiceController],
      providers: [
        AuthServiceService,
        {
          provide: DATABASE,
          useValue: trackedDb,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();
  });

  afterAll(async () => {
    try {
      if (db && testIpHash) {
        await db.orm.public.PasswordResetIpRateLimit
          .where({ ipHash: testIpHash })
          .delete();
      }
    } finally {
      try {
        if (app) {
          await app.close();
        }
      } finally {
        try {
          if (db) {
            await db.close();
          }
        } finally {
          if (originalSecret === undefined) {
            delete process.env.PASSWORD_RESET_IP_HASH_SECRET;
          } else {
            process.env.PASSWORD_RESET_IP_HASH_SECRET =
              originalSecret;
          }
        }
      }
    }
  });

  it('enforces the five-request IP limit through real HTTP', async () => {
    if (!app) {
      throw new Error('Nest application not initialized.');
    }

    const server = app.getHttpServer();

    // Send one request to discover the actual loopback socket IP.
    // The remaining requests must use the same HTTP server.
    const first = await request(server)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.101')
      .send({ email: 'nonexistent@example.test' })
      .expect(200);

    expect(first.body).toEqual(genericResponse);

    // Loopback may be represented as IPv4 or IPv4-mapped IPv6.
    // Query both possibilities using the temporary hashing secret.
    const possibleHashes = [
      hashPasswordResetClientIp('127.0.0.1'),
      hashPasswordResetClientIp('::1'),
    ];

    for (const hash of possibleHashes) {
      const records =
        await db.orm.public.PasswordResetIpRateLimit
          .where({ ipHash: hash })
          .all();

      if (records.length === 2) {
        testIpHash = hash;
        break;
      }
    }

    if (!testIpHash) {
      throw new Error(
        'Could not identify the HTTP loopback IP counters.',
      );
    }

    for (let index = 0; index < 4; index++) {
      const response = await request(server)
        .post('/auth/forgot-password')
        .set(
          'X-Forwarded-For',
          `203.0.113.${110 + index}`,
        )
        .send({
          email: `unknown-${index}@example.test`,
        })
        .expect(200);

      expect(response.body).toEqual(genericResponse);
    }

    const beforeBlocked =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(beforeBlocked).toHaveLength(2);

    for (const record of beforeBlocked) {
      expect(record.requestCount).toBe(5);
    }

    if (!lookupCount) {
      throw new Error('Account lookup tracker not initialized.');
    }

    const lookupsBeforeSixth = lookupCount();

    const sixth = await request(server)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '198.51.100.200')
      .send({ email: 'sixth@example.test' })
      .expect(200);

    expect(sixth.body).toEqual(genericResponse);

    expect(lookupCount()).toBe(lookupsBeforeSixth);

    const afterBlocked =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(afterBlocked).toHaveLength(2);

    for (const record of afterBlocked) {
      expect(record.requestCount).toBe(5);
    }

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});