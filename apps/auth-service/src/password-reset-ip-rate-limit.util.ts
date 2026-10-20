import { createHmac, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import * as ipaddr from 'ipaddr.js';

export const PASSWORD_RESET_IP_LIMIT_15_MINUTES = 5;
export const PASSWORD_RESET_IP_LIMIT_ONE_HOUR = 20;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

type RateLimitWindow = {
  windowType: string;
  windowStart: Temporal.Instant;
  maximum: number;
};

function getIpHashSecret(): Buffer {
  const secret = process.env.PASSWORD_RESET_IP_HASH_SECRET;

  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error(
      'PASSWORD_RESET_IP_HASH_SECRET is missing or invalid.',
    );
  }

  return Buffer.from(secret, 'hex');
}

export function hashPasswordResetClientIp(ip: string): string {
  if (typeof ip !== 'string' || !ipaddr.isValid(ip)) {
    throw new Error('A valid client IP address is required.');
  }

  // Canonicalize IPv4, IPv6, and IPv4-mapped IPv6.
  // Equivalent addresses must share the same rate-limit counter.
  const normalizedIp = ipaddr.process(ip).toNormalizedString();

  return createHmac('sha256', getIpHashSecret())
    .update('rimflex:password-reset-ip:', 'utf8')
    .update(normalizedIp, 'utf8')
    .digest('hex');
}

function getWindows(now: Date): RateLimitWindow[] {
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new Error('Invalid rate-limit timestamp.');
  }

  return [
    {
      windowType: 'FIFTEEN_MINUTES',
      windowStart: Temporal.Instant.fromEpochMilliseconds(
        Math.floor(nowMs / FIFTEEN_MINUTES_MS) *
          FIFTEEN_MINUTES_MS,
      ),
      maximum: PASSWORD_RESET_IP_LIMIT_15_MINUTES,
    },
    {
      windowType: 'ONE_HOUR',
      windowStart: Temporal.Instant.fromEpochMilliseconds(
        Math.floor(nowMs / ONE_HOUR_MS) * ONE_HOUR_MS,
      ),
      maximum: PASSWORD_RESET_IP_LIMIT_ONE_HOUR,
    },
  ];
}

export async function consumePasswordResetIpAllowance(
  db: any,
  clientIp: string,
  now: Date = new Date(),
): Promise<boolean> {
  const ipHash = hashPasswordResetClientIp(clientIp);
  const windows = getWindows(now);
  const timestamp = Temporal.Instant.fromEpochMilliseconds(
    now.getTime(),
  );

  return await db.transaction(async (tx: any) => {
    // Serialize checks for the same IP across app instances.
    const lockPlan = db.raw.sql`
      SELECT 1::int4 AS acquired
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtext('rimflex:password-reset-ip-rate-limit'),
          hashtext(${ipHash})
        )
      ) AS lock_result
    `.returnsRow({
      acquired: 'pg/int4@1',
    }).build();

    const lockRows = await tx.query(lockPlan);

    if (
      lockRows.length !== 1 ||
      lockRows[0]?.acquired !== 1
    ) {
      throw new Error('Could not acquire IP rate-limit lock.');
    }

    const existing = [];

    for (const window of windows) {
      const record =
        await tx.orm.public.PasswordResetIpRateLimit
          .where({
            ipHash,
            windowType: window.windowType,
            windowStart: window.windowStart,
          })
          .first();

      if (
        record &&
        (
          !Number.isSafeInteger(record.requestCount) ||
          record.requestCount < 0
        )
      ) {
        throw new Error('Invalid stored IP rate-limit counter.');
      }

      if (record && record.requestCount >= window.maximum) {
        return false;
      }

      existing.push({ window, record });
    }

    for (const { window, record } of existing) {
      if (record) {
        await tx.orm.public.PasswordResetIpRateLimit
          .where({ id: record.id })
          .update({
            requestCount: record.requestCount + 1,
            updatedAt: timestamp,
          });
      } else {
        await tx.orm.public.PasswordResetIpRateLimit.create({
          id: randomUUID(),
          ipHash,
          windowType: window.windowType,
          windowStart: window.windowStart,
          requestCount: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    return true;
  });
}