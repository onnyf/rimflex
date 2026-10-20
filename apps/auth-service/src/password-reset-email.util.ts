import { isValidPasswordResetToken } from './password-reset-token.util';

const RESEND_API_URL = 'https://api.resend.com/emails';

export function buildPasswordResetUrl(
  token: string,
  frontendOrigin: string,
  production = process.env.NODE_ENV === 'production',
): string {
  if (!isValidPasswordResetToken(token)) {
    throw new Error('Invalid password reset token');
  }

  if (typeof frontendOrigin !== 'string' || !frontendOrigin.trim()) {
    throw new Error('FRONTEND_URL is not configured');
  }

  let origin: URL;

  try {
    origin = new URL(frontendOrigin);
  } catch {
    throw new Error('Invalid FRONTEND_URL');
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error('FRONTEND_URL must be a clean HTTP(S) origin');
  }

  if (production && origin.protocol !== 'https:') {
    throw new Error('Production FRONTEND_URL must use HTTPS');
  }

  if (
    origin.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  ) {
    throw new Error('HTTP frontend URLs are restricted to localhost');
  }

  const resetUrl = new URL('/reset-password', origin.origin);

  resetUrl.hash = new URLSearchParams({ token }).toString();

  return resetUrl.toString();
}

export async function sendPasswordResetEmail(
  recipientEmail: string,
  token: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const frontendUrl = process.env.FRONTEND_URL;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL is not configured');
  }

  const resetUrl = buildPasswordResetUrl(token, frontendUrl);

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RIMFLEX <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: 'Reset your RIMFLEX password',
      text:
        'We received a request to reset your RIMFLEX password.\n\n' +
        `Open this link to reset your password:\n${resetUrl}\n\n` +
        'This link expires in 15 minutes and can only be used once.\n\n' +
        'If you did not request a password reset, ignore this email.',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `Password reset email delivery failed (HTTP ${response.status})`,
    );
  }
}
