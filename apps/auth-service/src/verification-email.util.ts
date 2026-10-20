const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendVerificationEmail(
  recipientEmail: string,
  code: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  if (!/^[0-9]{6}$/.test(code)) {
    throw new Error('Verification code must contain six digits.');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RIMFLEX <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: 'Verify your RIMFLEX email',
      text:
        `Your RIMFLEX verification code is ${code}.\n\n` +
        'This code expires in 5 minutes.\n' +
        'If you did not request this code, you can ignore this email.',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `Verification email delivery failed (HTTP ${response.status}).`,
    );
  }
}
