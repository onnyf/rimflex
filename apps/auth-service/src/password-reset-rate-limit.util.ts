export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
export const PASSWORD_RESET_MAX_REQUESTS_PER_HOUR = 5;

export interface PasswordResetRequestHistory {
  createdAt: Date | string | { toString(): string };
}

export function isPasswordResetRequestAllowed(
  previousRequests: PasswordResetRequestHistory[],
  now: Date = new Date(),
): boolean {
  const nowMs = now.getTime();

  const requestTimes = previousRequests
    .map((request) =>
      request.createdAt instanceof Date
        ? request.createdAt.getTime()
        : new Date(request.createdAt.toString()).getTime(),
    )
    .filter((time) => Number.isFinite(time) && time <= nowMs);

  const lastHour = requestTimes.filter(
    (time) => time > nowMs - 60 * 60 * 1000,
  );

  if (lastHour.length >= PASSWORD_RESET_MAX_REQUESTS_PER_HOUR) {
    return false;
  }

  const mostRecent = Math.max(0, ...requestTimes);

  if (
    mostRecent > 0 &&
    nowMs - mostRecent < PASSWORD_RESET_COOLDOWN_SECONDS * 1000
  ) {
    return false;
  }

  return true;
}
