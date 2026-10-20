import {
  PASSWORD_RESET_COOLDOWN_SECONDS,
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR,
  isPasswordResetRequestAllowed,
} from './password-reset-rate-limit.util';

describe('Password reset request rate limiting', () => {
  const now = new Date('2026-10-15T08:00:00.000Z');

  it('allows the first request', () => {
    expect(isPasswordResetRequestAllowed([], now)).toBe(true);
  });

  it('blocks requests within the cooldown period', () => {
    const requests = [
      { createdAt: new Date(now.getTime() - 30000) },
    ];

    expect(isPasswordResetRequestAllowed(requests, now)).toBe(false);
    expect(PASSWORD_RESET_COOLDOWN_SECONDS).toBe(60);
  });

  it('allows requests after cooldown when below hourly limit', () => {
    const requests = [
      { createdAt: new Date(now.getTime() - 61000) },
    ];

    expect(isPasswordResetRequestAllowed(requests, now)).toBe(true);
  });

  it('blocks requests at the hourly maximum', () => {
    const requests = Array.from({ length: 5 }, (_, index) => ({
      createdAt: new Date(now.getTime() - (index + 1) * 120000),
    }));

    expect(isPasswordResetRequestAllowed(requests, now)).toBe(false);
    expect(PASSWORD_RESET_MAX_REQUESTS_PER_HOUR).toBe(5);
  });

  it('ignores requests older than one hour', () => {
    const requests = [
      { createdAt: new Date(now.getTime() - 3600001) },
    ];

    expect(isPasswordResetRequestAllowed(requests, now)).toBe(true);
  });

  it('accepts string timestamps', () => {
    const requests = [
      { createdAt: new Date(now.getTime() - 30000).toISOString() },
    ];

    expect(isPasswordResetRequestAllowed(requests, now)).toBe(false);
  });
});
