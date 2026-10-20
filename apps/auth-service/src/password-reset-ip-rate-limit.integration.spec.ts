import { jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';

import {
  consumePasswordResetIpAllowance,
  hashPasswordResetClientIp,
} from './password-reset-ip-rate-limit.util';

jest.setTimeout(30000);

describe('Password reset IP limiter database smoke test', () => {
  let db: any;
  const testIpHashes = new Set<string>();

  const originalSecret =
    process.env.PASSWORD_RESET_IP_HASH_SECRET;

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
        'Refusing to run outside doorstep_auth_test.',
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
  });

  afterAll(async () => {
    try {
      if (db) {
        for (const ipHash of testIpHashes) {
          await db.orm.public.PasswordResetIpRateLimit
            .where({ ipHash })
            .delete();
        }
      }
    } finally {
      if (db) {
        await db.close();
      }

      if (originalSecret === undefined) {
        delete process.env.PASSWORD_RESET_IP_HASH_SECRET;
      } else {
        process.env.PASSWORD_RESET_IP_HASH_SECRET =
          originalSecret;
      }
    }
  });

  it('creates and increments both database counters', async () => {
    const clientIp = '192.0.2.101';

    const testIpHash = hashPasswordResetClientIp(clientIp);
    testIpHashes.add(testIpHash);

    const now = new Date('2026-10-15T12:07:00.000Z');

    const first = await consumePasswordResetIpAllowance(
      db,
      clientIp,
      now,
    );

    expect(first).toBe(true);

    const second = await consumePasswordResetIpAllowance(
      db,
      clientIp,
      now,
    );

    expect(second).toBe(true);

    const records =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(records).toHaveLength(2);

    const counters = new Map(
      records.map(
        (record: any) => [
          record.windowType,
          record.requestCount,
        ],
      ),
    );

    expect(counters.get('FIFTEEN_MINUTES')).toBe(2);
    expect(counters.get('ONE_HOUR')).toBe(2);
  });

  it('rejects the sixth request within fifteen minutes', async () => {
    const clientIp = '192.0.2.102';
    const testIpHash = hashPasswordResetClientIp(clientIp);

    testIpHashes.add(testIpHash);

    const now = new Date('2026-10-15T12:08:00.000Z');

    for (let attempt = 1; attempt <= 5; attempt++) {
      const allowed = await consumePasswordResetIpAllowance(
        db,
        clientIp,
        now,
      );

      expect(allowed).toBe(true);
    }

    const denied = await consumePasswordResetIpAllowance(
      db,
      clientIp,
      now,
    );

    expect(denied).toBe(false);

    const records =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(records).toHaveLength(2);

    const counters = new Map(
      records.map(
        (record: any) => [
          record.windowType,
          record.requestCount,
        ],
      ),
    );

    expect(counters.get('FIFTEEN_MINUTES')).toBe(5);
    expect(counters.get('ONE_HOUR')).toBe(5);
  });

  it('rejects the twenty-first request within one hour', async () => {
    const clientIp = '192.0.2.103';
    const testIpHash = hashPasswordResetClientIp(clientIp);

    testIpHashes.add(testIpHash);

    const windowTimes = [
      '2026-10-15T12:01:00.000Z',
      '2026-10-15T12:16:00.000Z',
      '2026-10-15T12:31:00.000Z',
      '2026-10-15T12:46:00.000Z',
    ];

    for (const time of windowTimes) {
      const now = new Date(time);

      for (let attempt = 0; attempt < 5; attempt++) {
        const allowed = await consumePasswordResetIpAllowance(
          db,
          clientIp,
          now,
        );

        expect(allowed).toBe(true);
      }
    }

    const denied = await consumePasswordResetIpAllowance(
      db,
      clientIp,
      new Date('2026-10-15T12:47:00.000Z'),
    );

    expect(denied).toBe(false);

    const records =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    const hourlyRecords = records.filter(
      (record: any) => record.windowType === 'ONE_HOUR',
    );

    const fifteenMinuteRecords = records.filter(
      (record: any) => record.windowType === 'FIFTEEN_MINUTES',
    );

    expect(hourlyRecords).toHaveLength(1);
    expect(hourlyRecords[0].requestCount).toBe(20);

    expect(fifteenMinuteRecords).toHaveLength(4);

    for (const record of fifteenMinuteRecords) {
      expect(record.requestCount).toBe(5);
    }

    expect(records).toHaveLength(5);
  });

  it('enforces the limit under concurrent requests', async () => {
    const clientIp = '192.0.2.104';
    const testIpHash = hashPasswordResetClientIp(clientIp);

    testIpHashes.add(testIpHash);

    const now = new Date('2026-10-15T13:07:00.000Z');

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumePasswordResetIpAllowance(db, clientIp, now),
      ),
    );

    const accepted = results.filter(
      (result) => result === true,
    ).length;

    const rejected = results.filter(
      (result) => result === false,
    ).length;

    expect(accepted).toBe(5);
    expect(rejected).toBe(7);

    const records =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(records).toHaveLength(2);

    const counters = new Map(
      records.map(
        (record: any) => [
          record.windowType,
          record.requestCount,
        ],
      ),
    );

    expect(counters.get('FIFTEEN_MINUTES')).toBe(5);
    expect(counters.get('ONE_HOUR')).toBe(5);
  });

  it('rolls back both counters when the second write fails', async () => {
    const clientIp = '192.0.2.105';
    const testIpHash = hashPasswordResetClientIp(clientIp);

    testIpHashes.add(testIpHash);

    const now = new Date('2026-10-15T14:07:00.000Z');

    const injectedFailure = new Error(
      'Intentional second counter write failure',
    );

    const faultDb = {
      raw: db.raw,

      transaction: async (callback: (tx: any) => Promise<any>) =>
        db.transaction(async (tx: any) => {
          let createCount = 0;

          const wrappedTx = {
            query: tx.query.bind(tx),

            orm: {
              public: {
                PasswordResetIpRateLimit: {
                  where: (...args: any[]) =>
                    tx.orm.public.PasswordResetIpRateLimit.where(
                      ...args,
                    ),

                  create: async (...args: any[]) => {
                    createCount++;

                    if (createCount === 2) {
                      throw injectedFailure;
                    }

                    return tx.orm.public.PasswordResetIpRateLimit.create(
                      ...args,
                    );
                  },
                },
              },
            },
          };

          return callback(wrappedTx);
        }),
    };

    await expect(
      consumePasswordResetIpAllowance(
        faultDb,
        clientIp,
        now,
      ),
    ).rejects.toThrow(
      'Intentional second counter write failure',
    );

    const records =
      await db.orm.public.PasswordResetIpRateLimit
        .where({ ipHash: testIpHash })
        .all();

    expect(records).toHaveLength(0);
  });
});
