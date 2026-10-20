import { Temporal } from '@js-temporal/polyfill';
import { createHash, randomBytes } from 'node:crypto';

export const PASSWORD_RESET_TOKEN_DURATION_MS = 15 * 60 * 1000;

const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidPasswordResetToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    PASSWORD_RESET_TOKEN_PATTERN.test(token)
  );
}

export function hashPasswordResetToken(token: string): string {
  if (!isValidPasswordResetToken(token)) {
    throw new Error('Invalid password reset token format');
  }

  return createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

export function getPasswordResetExpiration(): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(
    Date.now() + PASSWORD_RESET_TOKEN_DURATION_MS,
  );
}
