import { Temporal } from '@js-temporal/polyfill';
import { EMAIL_OTP_MAX_ATTEMPTS } from './email-otp.util';

export async function recordFailedEmailOtpAttempt(
  db: any,
  recordId: string,
  userId: string,
): Promise<boolean> {
  if (!recordId || !userId) {
    return false;
  }

  const now = Temporal.Now.instant();

  for (let currentAttempt = 0;
    currentAttempt < EMAIL_OTP_MAX_ATTEMPTS;
    currentAttempt++) {
    const updatedCount =
      await db.orm.public.EmailVerificationCode
        .where({
          id: recordId,
          userId,
          consumedAt: null,
          attemptCount: currentAttempt,
        })
        .where((otp: any) => otp.expiresAt.gt(now))
        .updateAndCount({
          attemptCount: currentAttempt + 1,
        });

    if (updatedCount === 1) {
      return true;
    }
  }

  return false;
}
