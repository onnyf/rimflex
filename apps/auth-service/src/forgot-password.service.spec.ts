import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

const mockCreateRequest = jest.fn<(...args: any[]) => Promise<string | null>>();
const mockSendEmail = jest.fn<(...args: any[]) => Promise<void>>();
const mockIpAllowance = jest.fn<(...args: any[]) => Promise<boolean>>();
const testClientIp = '192.0.2.150';

jest.unstable_mockModule('./password-reset-ip-rate-limit.util', () => ({
  consumePasswordResetIpAllowance: mockIpAllowance,
}));

jest.unstable_mockModule('./password-reset-request.util', () => ({
  createCustomerPasswordResetRequest: mockCreateRequest,
}));

jest.unstable_mockModule('./password-reset-email.util', () => ({
  sendPasswordResetEmail: mockSendEmail,
}));

const { AuthServiceService } = await import('./auth-service.service');

describe('Forgot-password service', () => {
  let service: InstanceType<typeof AuthServiceService>;
  let findUser: ReturnType<typeof jest.fn>;

  const genericResponse = {
    message:
      'If an eligible account exists, a password reset link will be sent.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIpAllowance.mockResolvedValue(true);

    findUser = jest.fn();

    const db = {
      orm: {
        public: {
          User: {
            where: jest.fn(() => ({
              first: findUser,
            })),
          },
        },
      },
    };

    service = new AuthServiceService(db as any);
  });

  it('rejects invalid email addresses', async () => {
    await expect(
      service.requestCustomerPasswordReset({ email: 'invalid-email' }, testClientIp),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(findUser).not.toHaveBeenCalled();
  });

  it('returns a generic response for unknown accounts', async () => {
    findUser.mockResolvedValue(null);

    const result = await service.requestCustomerPasswordReset({
      email: 'unknown@example.com',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns a generic response for unverified accounts', async () => {
    findUser.mockResolvedValue({
      id: 'unverified-customer',
      email: 'unverified@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: null,
    });

    const result = await service.requestCustomerPasswordReset({
      email: 'unverified@example.com',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns a generic response for inactive accounts', async () => {
    findUser.mockResolvedValue({
      id: 'inactive-customer',
      email: 'inactive@example.com',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      emailVerifiedAt: new Date(),
    });

    const result = await service.requestCustomerPasswordReset({
      email: 'inactive@example.com',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends a reset email for an eligible customer', async () => {
    findUser.mockResolvedValue({
      id: 'eligible-customer',
      email: 'eligible@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });

    mockCreateRequest.mockResolvedValue('test-reset-token');
    mockSendEmail.mockResolvedValue(undefined);

    const result = await service.requestCustomerPasswordReset({
      email: '  ELIGIBLE@EXAMPLE.COM  ',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockCreateRequest).toHaveBeenCalledWith(
      expect.anything(),
      'eligible-customer',
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      'eligible@example.com',
      'test-reset-token',
    );
  });

  it('does not send email when request is rate-limited', async () => {
    findUser.mockResolvedValue({
      id: 'limited-customer',
      email: 'limited@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });

    mockCreateRequest.mockResolvedValue(null);

    const result = await service.requestCustomerPasswordReset({
      email: 'limited@example.com',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('hides email-delivery failures from the caller', async () => {
    findUser.mockResolvedValue({
      id: 'delivery-failure-customer',
      email: 'delivery@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });

    mockCreateRequest.mockResolvedValue('test-reset-token');
    mockSendEmail.mockRejectedValue(new Error('Simulated delivery failure'));

    const result = await service.requestCustomerPasswordReset({
      email: 'delivery@example.com',
    }, testClientIp);

    expect(result).toEqual(genericResponse);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('blocks an IP before looking up an account', async () => {
    mockIpAllowance.mockResolvedValue(false);

    const result = await service.requestCustomerPasswordReset(
      { email: 'eligible@example.com' },
      testClientIp,
    );

    expect(result).toEqual(genericResponse);
    expect(mockIpAllowance).toHaveBeenCalledTimes(1);
    expect(findUser).not.toHaveBeenCalled();
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed when the IP limiter encounters a database error', async () => {
    mockIpAllowance.mockRejectedValue(
      new Error('Simulated rate-limit database failure'),
    );

    await expect(
      service.requestCustomerPasswordReset(
        { email: 'eligible@example.com' },
        testClientIp,
      ),
    ).rejects.toThrow('Simulated rate-limit database failure');

    expect(findUser).not.toHaveBeenCalled();
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('checks the IP allowance before validating the email', async () => {
    mockIpAllowance.mockResolvedValue(false);

    const result = await service.requestCustomerPasswordReset(
      { email: 'invalid-email' },
      testClientIp,
    );

    expect(result).toEqual(genericResponse);
    expect(mockIpAllowance).toHaveBeenCalledTimes(1);
    expect(findUser).not.toHaveBeenCalled();
  });
});
