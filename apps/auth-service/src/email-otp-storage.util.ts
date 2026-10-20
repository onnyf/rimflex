import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import {
  generateEmailOtp,
  hashEmailOtp,
  EMAIL_OTP_EXPIRY_MINUTES,
} from './email-otp.util';

export interface CreatedEmailOtp {
  code: string;
  recordId: string;
}

export async function createEmailOtpRecord(
  db: any,
  userId: string,
): Promise<CreatedEmailOtp> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('A valid user ID is required.');
  }

  const code = generateEmailOtp();
  const codeHash = hashEmailOtp(code);
  const recordId = randomUUID();

  const expiresAt = Temporal.Now.instant().add({
    minutes: EMAIL_OTP_EXPIRY_MINUTES,
  });

  await db.orm.public.EmailVerificationCode.create({
    id: recordId,
    userId,
    codeHash,
    expiresAt,
    attemptCount: 0,
  });

  return {
    code,
    recordId,
  };
}
