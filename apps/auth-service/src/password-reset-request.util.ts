import { randomUUID } from 'node:crypto';

import {
  generatePasswordResetToken,
  getPasswordResetExpiration,
  hashPasswordResetToken,
} from './password-reset-token.util';

import {
  isPasswordResetRequestAllowed,
} from './password-reset-rate-limit.util';

export async function createCustomerPasswordResetRequest(
  db: any,
  userId: string,
): Promise<string | null> {
  if (typeof userId !== 'string' || !userId.trim()) {
    return null;
  }

  return await db.transaction(async (tx: any) => {
    // Serialize concurrent requests for the same customer.
    const lockPlan = db.raw.sql`
      SELECT 1::int4 AS acquired
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtext('rimflex:customer-password-reset-request'),
          hashtext(${userId})
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
      throw new Error('Could not acquire password reset request lock');
    }

    // Recheck account eligibility while holding the lock.
    const user = await tx.orm.public.User
      .where({ id: userId })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.status !== 'ACTIVE' ||
      user.emailVerifiedAt === null
    ) {
      return null;
    }

    const previousRequests = await tx.orm.public.PasswordResetToken
      .where({ userId: user.id })
      .all();

    if (!isPasswordResetRequestAllowed(previousRequests)) {
      return null;
    }

    const token = generatePasswordResetToken();

    await tx.orm.public.PasswordResetToken.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      expiresAt: getPasswordResetExpiration(),
    });

    // Return the raw token only to the calling service.
    // The database stores only its SHA-256 hash.
    return token;
  });
}
