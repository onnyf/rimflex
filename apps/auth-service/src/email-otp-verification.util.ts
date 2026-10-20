import { BadRequestException } from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  verifyEmailOtpHash,
} from './email-otp.util';

export interface EmailOtpRecord {
  codeHash: string;
  expiresAt: Temporal.Instant;
  attemptCount: number;
  consumedAt: Temporal.Instant | null;
}

export function assertEmailOtpUsable(
  record: EmailOtpRecord,
  now: Temporal.Instant = Temporal.Now.instant(),
): void {
  if (record.consumedAt !== null) {
    throw new BadRequestException(
      'This verification code has already been used.',
    );
  }

  if (Temporal.Instant.compare(record.expiresAt, now) <= 0) {
    throw new BadRequestException(
      'Verification code has expired.',
    );
  }

  if (record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
    throw new BadRequestException(
      'Too many incorrect attempts. Request a new code.',
    );
  }
}

export function isEmailOtpCorrect(
  record: EmailOtpRecord,
  submittedCode: string,
): boolean {
  assertEmailOtpUsable(record);

  return verifyEmailOtpHash(
    submittedCode,
    record.codeHash,
  );
}
