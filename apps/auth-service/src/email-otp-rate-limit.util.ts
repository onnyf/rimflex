import { HttpException, HttpStatus } from '@nestjs/common';

export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const EMAIL_OTP_MAX_REQUESTS_PER_HOUR = 5;

export interface EmailOtpRequestHistory {
  createdAt: Date | string | { toString(): string };
}

export function assertEmailOtpRequestAllowed(
  previousRequests: EmailOtpRequestHistory[],
  now: Date = new Date(),
): void {
  const nowMs = now.getTime();

  const requestTimes = previousRequests
    .map((request) =>
      request.createdAt instanceof Date
        ? request.createdAt.getTime()
        : new Date(request.createdAt.toString()).getTime()
    )
    .filter((time) => Number.isFinite(time) && time <= nowMs);

  const lastHour = requestTimes.filter(
    (time) => time > nowMs - 60 * 60 * 1000,
  );

  if (lastHour.length >= EMAIL_OTP_MAX_REQUESTS_PER_HOUR) {
    throw new HttpException(
      'Too many verification requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  const mostRecent = Math.max(0, ...requestTimes);

  if (
    mostRecent > 0 &&
    nowMs - mostRecent < EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    throw new HttpException(
      'Please wait before requesting another verification code.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
