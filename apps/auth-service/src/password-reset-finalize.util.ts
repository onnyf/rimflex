import { Temporal } from '@js-temporal/polyfill';
import { hashPassword } from './password.util';
import {
  hashPasswordResetToken,
  isValidPasswordResetToken,
} from './password-reset-token.util';

export async function finalizeCustomerPasswordReset(
  db: any,
  token: string,
  newPassword: string,
): Promise<boolean> {
  if (!isValidPasswordResetToken(token)) {
    return false;
  }

  if (
    typeof newPassword !== 'string' ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    return false;
  }

  const tokenHash = hashPasswordResetToken(token);

  const record = await db.orm.public.PasswordResetToken
    .where({ tokenHash })
    .first();

  if (!record) {
    return false;
  }

  // Perform the expensive password hash before acquiring the
  // transaction lock.
  const passwordHash = await hashPassword(newPassword);

  return await db.transaction(async (tx: any) => {
    // Serialize password-reset operations for this customer.
    const lockPlan = db.raw.sql`
      SELECT 1::int4 AS acquired
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtext('rimflex:customer-password-reset'),
          hashtext(${record.userId})
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
      throw new Error('Could not acquire password reset lock');
    }

    const user = await tx.orm.public.User
      .where({ id: record.userId })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.status !== 'ACTIVE' ||
      user.emailVerifiedAt === null
    ) {
      return false;
    }

    const now = Temporal.Now.instant();

    const consumedCount = await tx.orm.public.PasswordResetToken
      .where({
        id: record.id,
        userId: user.id,
        consumedAt: null,
      })
      .where((reset: any) => reset.expiresAt.gt(now))
      .updateAndCount({
        consumedAt: now,
      });

    if (consumedCount !== 1) {
      return false;
    }

    const updatedCount = await tx.orm.public.User
      .where({
        id: user.id,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      })
      .updateAndCount({
        passwordHash,
      });

    if (updatedCount !== 1) {
      throw new Error('Password reset could not be finalized');
    }

    const activeSessions = await tx.orm.public.AuthSession
      .where({ userId: user.id, revokedAt: null })
      .all();

    const revokedCount = await tx.orm.public.AuthSession
      .where({ userId: user.id, revokedAt: null })
      .updateAndCount({
        revokedAt: now,
      });

    if (revokedCount !== activeSessions.length) {
      throw new Error('Customer sessions could not all be revoked');
    }

    return true;
  });
}
