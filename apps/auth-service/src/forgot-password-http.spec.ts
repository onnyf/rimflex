import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import request from 'supertest';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';

describe('Forgot-password HTTP security', () => {
  let app: INestApplication;

  const genericResponse = {
    message:
      'If an eligible account exists, a password reset link will be sent.',
  };

  const requestReset = jest.fn<
    (input: { email: string }, clientIp: string) =>
      Promise<{ message: string }>
  >();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthServiceController],
      providers: [
        {
          provide: AuthServiceService,
          useValue: {
            requestCustomerPasswordReset: requestReset,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    requestReset.mockReset();
    requestReset.mockResolvedValue(genericResponse);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns HTTP 200 and the generic response', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'customer@example.com' })
      .expect(200);

    expect(response.body).toEqual(genericResponse);
    expect(requestReset).toHaveBeenCalledTimes(1);
    expect(requestReset).toHaveBeenCalledWith(
      { email: 'customer@example.com' },
      expect.any(String),
    );
  });

  it('uses the socket IP instead of a forged forwarded header', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.99')
      .send({ email: 'customer@example.com' })
      .expect(200);

    expect(requestReset).toHaveBeenCalledTimes(1);

    const receivedIp = requestReset.mock.calls[0]?.[1];

    expect(receivedIp).toBeTruthy();
    expect(receivedIp).not.toBe('203.0.113.99');
  });

  it('rejects requests when the socket IP is unavailable', async () => {
    const controller = app.get(AuthServiceController);

    await expect(
      controller.requestCustomerPasswordReset(
        { email: 'customer@example.com' },
        { socket: {} } as any,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(requestReset).not.toHaveBeenCalled();
  });

  it('preserves the generic response for rate-limited requests', async () => {
    requestReset.mockResolvedValue(genericResponse);

    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(200);

    expect(response.body).toEqual(genericResponse);
    expect(requestReset).toHaveBeenCalledTimes(1);
  });

  it('does not accept a client IP supplied in the body', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({
        email: 'customer@example.com',
        clientIp: '203.0.113.88',
      })
      .expect(200);

    expect(requestReset).toHaveBeenCalledTimes(1);
    expect(requestReset.mock.calls[0]?.[1]).not.toBe(
      '203.0.113.88',
    );
  });
});