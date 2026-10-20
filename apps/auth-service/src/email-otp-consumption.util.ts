import { Temporal } from '@js-temporal/polyfill';

export async function consumeEmailOtpOnce(
  db: any,
  recordId: string,
  userId: string,
): Promise<boolean> {
  if (!recordId || !userId) {
    return false;
  }

  const now = Temporal.Now.instant();

  const updatedCount =
    await db.orm.public.EmailVerificationCode
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

  return updatedCount === 1;
}
