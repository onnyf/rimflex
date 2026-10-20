import { randomBytes } from 'node:crypto';

import {
  hashPasswordResetClientIp,
} from './password-reset-ip-rate-limit.util';

describe('Password reset IP hashing', () => {
  const originalSecret =
    process.env.PASSWORD_RESET_IP_HASH_SECRET;

  beforeEach(() => {
    process.env.PASSWORD_RESET_IP_HASH_SECRET =
      randomBytes(32).toString('hex');
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.PASSWORD_RESET_IP_HASH_SECRET;
    } else {
      process.env.PASSWORD_RESET_IP_HASH_SECRET =
        originalSecret;
    }
  });

  it('hashes equivalent IPv6 addresses identically', () => {
    expect(
      hashPasswordResetClientIp('2001:db8::1'),
    ).toBe(
      hashPasswordResetClientIp(
        '2001:0db8:0:0:0:0:0:1',
      ),
    );
  });

  it('treats IPv4-mapped IPv6 as the same IPv4 address', () => {
    expect(
      hashPasswordResetClientIp('::ffff:192.0.2.10'),
    ).toBe(
      hashPasswordResetClientIp('192.0.2.10'),
    );
  });

  it('normalizes IPv6 letter case', () => {
    expect(
      hashPasswordResetClientIp('2001:DB8::ABCD'),
    ).toBe(
      hashPasswordResetClientIp('2001:db8::abcd'),
    );
  });

  it('produces different hashes for different IPs', () => {
    expect(
      hashPasswordResetClientIp('192.0.2.10'),
    ).not.toBe(
      hashPasswordResetClientIp('192.0.2.11'),
    );
  });

  it('produces a 64-character hexadecimal hash', () => {
    expect(
      hashPasswordResetClientIp('192.0.2.10'),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    'not-an-ip',
    '192.0.2.999',
    '2001:db8::zzzz',
    '',
  ])('rejects invalid IP input: %s', (ip) => {
    expect(() => hashPasswordResetClientIp(ip))
      .toThrow('A valid client IP address is required.');
  });

  it('rejects a missing hashing secret', () => {
    delete process.env.PASSWORD_RESET_IP_HASH_SECRET;

    expect(() =>
      hashPasswordResetClientIp('192.0.2.10'),
    ).toThrow(
      'PASSWORD_RESET_IP_HASH_SECRET is missing or invalid.',
    );
  });

  it('rejects an incorrectly formatted hashing secret', () => {
    process.env.PASSWORD_RESET_IP_HASH_SECRET =
      'not-a-valid-secret';

    expect(() =>
      hashPasswordResetClientIp('192.0.2.10'),
    ).toThrow(
      'PASSWORD_RESET_IP_HASH_SECRET is missing or invalid.',
    );
  });

  it('uses the configured secret when hashing', () => {
    const ip = '192.0.2.10';

    const firstHash = hashPasswordResetClientIp(ip);

    process.env.PASSWORD_RESET_IP_HASH_SECRET =
      randomBytes(32).toString('hex');

    const secondHash = hashPasswordResetClientIp(ip);

    expect(firstHash).not.toBe(secondHash);
  });
});