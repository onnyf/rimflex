import { Temporal } from '@js-temporal/polyfill';

export async function finalizeEmailVerification(
  db: any,
  recordId: string,
  userId: string,
): Promise<boolean> {
  if (!recordId || !userId) {
    return false;
  }

  return await db.transaction(async (tx: any) => {
    const now = Temporal.Now.instant();

    const user = await tx.orm.public.User
      .where({ id: userId })
      .first();

    if (!user || user.emailVerifiedAt !== null) {
      return false;
    }

    const consumedCount =
      await tx.orm.public.EmailVerificationCode
        .where({
          id: recordId,
          userId,
          consumedAt: null,
        })
        .where((otp: any) => otp.attemptCount.lt(5))
        .where((otp: any) => otp.expiresAt.gt(now))
        .updateAndCount({
          consumedAt: now,
        });

    if (consumedCount !== 1) {
      return false;
    }

    const verifiedCount =
      await tx.orm.public.User
        .where({
          id: userId,
          emailVerifiedAt: null,
        })
        .updateAndCount({
          emailVerifiedAt: now,
        });

    if (verifiedCount !== 1) {
      throw new Error(
        'Email verification could not be finalized.',
      );
    }

    return true;
  });
}