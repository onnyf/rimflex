import {
  buildPasswordResetUrl,
  sendPasswordResetEmail,
} from './password-reset-email.util';
import { generatePasswordResetToken } from './password-reset-token.util';

describe('Password reset email utility', () => {
  const token = generatePasswordResetToken();

  it('builds a localhost reset link for development', () => {
    const url = buildPasswordResetUrl(
      token,
      'http://localhost:3000',
      false,
    );

    expect(url).toContain('http://localhost:3000/reset-password#');
    expect(url).toContain(token);
  });

  it('accepts HTTPS origins in production', () => {
    const url = buildPasswordResetUrl(
      token,
      'https://app.example.com',
      true,
    );

    expect(url).toStartWith;
    expect(url.startsWith('https://app.example.com/reset-password#')).toBe(true);
  });

  it('rejects HTTP origins in production', () => {
    expect(() =>
      buildPasswordResetUrl(token, 'http://localhost:3000', true),
    ).toThrow('HTTPS');
  });

  it('rejects untrusted remote HTTP origins', () => {
    expect(() =>
      buildPasswordResetUrl(token, 'http://example.com', false),
    ).toThrow('localhost');
  });

  it('rejects origins containing credentials or URL fragments', () => {
    expect(() =>
      buildPasswordResetUrl(token, 'https://user:pass@example.com', true),
    ).toThrow();

    expect(() =>
      buildPasswordResetUrl(token, 'https://example.com/#other', true),
    ).toThrow();
  });

  it('rejects invalid tokens', () => {
    expect(() =>
      buildPasswordResetUrl('invalid', 'https://example.com', true),
    ).toThrow('Invalid password reset token');
  });

  it('sends the reset email using Resend without a real network request', async () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrontendUrl = process.env.FRONTEND_URL;
    const previousNodeEnv = process.env.NODE_ENV;
    const originalFetch = global.fetch;

    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    try {
      process.env.RESEND_API_KEY = 'unit-test-placeholder';
      process.env.FRONTEND_URL = 'https://app.example.com';
      process.env.NODE_ENV = 'production';

      global.fetch = fetchMock as typeof fetch;

      await sendPasswordResetEmail('customer@example.com', token);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe('https://api.resend.com/emails');

      const payload = JSON.parse(options.body);

      expect(payload.to).toEqual(['customer@example.com']);
      expect(payload.subject).toContain('Reset');
      expect(payload.text).toContain('15 minutes');
      expect(payload.text).toContain(token);
    } finally {
      global.fetch = originalFetch;

      if (previousApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousApiKey;
      }

      if (previousFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = previousFrontendUrl;
      }

      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });
});
