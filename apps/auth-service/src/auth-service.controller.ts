import type { Request } from 'express';
import { ForbiddenException, UnauthorizedException, ServiceUnavailableException, Req, Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res, } from '@nestjs/common';

import { AuthServiceService } from './auth-service.service';
import type { RegisterCustomerInput } from './auth-service.service';
import type { Response } from 'express';
import { SESSION_DURATION_MS } from './session-token.util';

@Controller('auth')
export class AuthServiceController {
  constructor(private readonly authServiceService: AuthServiceService) {}

  @Get()
  getHello(): string {
    return this.authServiceService.getHello();
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async registerCustomer(@Body() body: RegisterCustomerInput) {
    return this.authServiceService.registerCustomer(body);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendCustomerEmailOtp(
    @Body() body: { email: string },
  ) {
    return this.authServiceService.resendCustomerEmailOtp(body);
  }
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyCustomerEmail(
    @Body() body: { email: string; code: string },
  ) {
    return this.authServiceService.verifyCustomerEmail(body);
  }
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async requestCustomerPasswordReset(
    @Body() body: { email: string },
    @Req() request: Request,
  ) {
    const clientIp = request.socket?.remoteAddress;

    if (!clientIp) {
      throw new ServiceUnavailableException(
        'Unable to process password reset request',
      );
    }

    return this.authServiceService.requestCustomerPasswordReset(
      body,
      clientIp,
    );
  }
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async loginCustomer(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authServiceService.loginCustomer(body);

    response.cookie('rimflex_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS,
      path: '/',
    });

    return {
      message: result.message,
      user: result.user,
    };
  }

  @Get('me')
  async getCurrentCustomer(@Req() request: Request) {
    const cookieHeader = request.headers.cookie ?? '';

    const sessionCookie = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('rimflex_session='));

    if (!sessionCookie) {
      throw new UnauthorizedException('Authentication required');
    }

    const sessionToken = sessionCookie.slice('rimflex_session='.length);

    const user = await this.authServiceService.validateCustomerSession(
      sessionToken,
    );

    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logoutCustomer(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const allowedLogoutOrigins = new Set([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);

    const requestOrigin = request.headers.origin;

    if (!requestOrigin || !allowedLogoutOrigins.has(requestOrigin)) {
      throw new ForbiddenException('Request origin is not allowed');
    }

    const cookieHeader = request.headers.cookie ?? '';

    const sessionCookie = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('rimflex_session='));

    if (sessionCookie) {
      const sessionToken = sessionCookie.slice('rimflex_session='.length);

      await this.authServiceService.revokeCustomerSession(sessionToken);
    }

    response.clearCookie('rimflex_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }
}
