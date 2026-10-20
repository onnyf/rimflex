import { Temporal } from '@js-temporal/polyfill';
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function getSessionExpiration(): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(
    Date.now() + SESSION_DURATION_MS,
  );
}