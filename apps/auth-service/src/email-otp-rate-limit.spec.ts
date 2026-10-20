import { HttpException } from '@nestjs/common';
import {
  assertEmailOtpRequestAllowed,
  EMAIL_OTP_MAX_REQUESTS_PER_HOUR,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
} from './email-otp-rate-limit.util';

describe('Customer email OTP rate limiting', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');

  it('rejects a sixth request within one hour', () => {
    const previousRequests = Array.from(
      { length: EMAIL_OTP_MAX_REQUESTS_PER_HOUR },
      (_, index) => ({
        createdAt: new Date(
          now.getTime() - (index + 1) * 120_000,
        ),
      }),
    );

    try {
      assertEmailOtpRequestAllowed(previousRequests, now);
      throw new Error('Expected HTTP 429');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).message).toContain(
        'Too many verification requests',
      );
    }
  });

  it('allows a request when previous requests are outside one hour', () => {
    const previousRequests = Array.from(
      { length: EMAIL_OTP_MAX_REQUESTS_PER_HOUR },
      (_, index) => ({
        createdAt: new Date(
          now.getTime() - 3_600_001 - index * 120_000,
        ),
      }),
    );

    expect(() =>
      assertEmailOtpRequestAllowed(previousRequests, now),
    ).not.toThrow();
  });

  it('rejects a resend inside the cooldown period', () => {
    const previousRequests = [{
      createdAt: new Date(
        now.getTime() -
          (EMAIL_OTP_RESEND_COOLDOWN_SECONDS - 1) * 1000,
      ),
    }];

    expect(() =>
      assertEmailOtpRequestAllowed(previousRequests, now),
    ).toThrow(HttpException);
  });

  it('allows a resend after the cooldown period', () => {
    const previousRequests = [{
      createdAt: new Date(
        now.getTime() -
          EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ),
    }];

    expect(() =>
      assertEmailOtpRequestAllowed(previousRequests, now),
    ).not.toThrow();
  });
});
