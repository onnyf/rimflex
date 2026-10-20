import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const EMAIL_OTP_EXPIRY_MINUTES = 5;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

function getOtpSecret(): Buffer {
  const secret = process.env.EMAIL_OTP_SECRET;

  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error('EMAIL_OTP_SECRET is missing or invalid.');
  }

  return Buffer.from(secret, 'hex');
}

export function generateEmailOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashEmailOtp(code: string): string {
  if (!/^[0-9]{6}$/.test(code)) {
    throw new Error('OTP must contain exactly six digits.');
  }

  return createHmac('sha256', getOtpSecret())
    .update(code, 'utf8')
    .digest('hex');
}

export function verifyEmailOtpHash(
  submittedCode: string,
  storedHash: string,
): boolean {
  if (!/^[0-9]{6}$/.test(submittedCode)) {
    return false;
  }

  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }

  const submittedHash = Buffer.from(hashEmailOtp(submittedCode), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');

  return timingSafeEqual(submittedHash, expectedHash);
}

export function getEmailOtpExpiryDate(): Date {
  return new Date(Date.now() + EMAIL_OTP_EXPIRY_MINUTES * 60_000);
}
