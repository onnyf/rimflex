import { Temporal } from '@js-temporal/polyfill';
import {
  PASSWORD_RESET_TOKEN_DURATION_MS,
  generatePasswordResetToken,
  getPasswordResetExpiration,
  hashPasswordResetToken,
  isValidPasswordResetToken,
} from './password-reset-token.util';

describe('Password reset token utility', () => {
  it('generates valid cryptographically random tokens', () => {
    const first = generatePasswordResetToken();
    const second = generatePasswordResetToken();

    expect(isValidPasswordResetToken(first)).toBe(true);
    expect(isValidPasswordResetToken(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('produces deterministic SHA-256 hashes', () => {
    const token = generatePasswordResetToken();

    const firstHash = hashPasswordResetToken(token);
    const secondHash = hashPasswordResetToken(token);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstHash).not.toContain(token);
  });

  it('rejects malformed reset tokens', () => {
    expect(isValidPasswordResetToken('invalid')).toBe(false);
    expect(isValidPasswordResetToken('')).toBe(false);
    expect(isValidPasswordResetToken(null)).toBe(false);

    expect(() => hashPasswordResetToken('invalid')).toThrow(
      'Invalid password reset token format',
    );
  });

  it('expires tokens after fifteen minutes', () => {
    const before = Date.now();
    const expiration = getPasswordResetExpiration();
    const after = Date.now();

    expect(PASSWORD_RESET_TOKEN_DURATION_MS).toBe(900000);

    expect(expiration instanceof Temporal.Instant).toBe(true);

    expect(expiration.epochMilliseconds).toBeGreaterThanOrEqual(
      before + PASSWORD_RESET_TOKEN_DURATION_MS,
    );

    expect(expiration.epochMilliseconds).toBeLessThanOrEqual(
      after + PASSWORD_RESET_TOKEN_DURATION_MS,
    );
  });
});
