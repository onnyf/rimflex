import { Temporal } from '@js-temporal/polyfill';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DATABASE } from './database.provider';
import { hashPassword, verifyPassword } from './password.util';
import { isEmailOtpCorrect } from './email-otp-verification.util';
import { recordFailedEmailOtpAttempt } from './email-otp-attempts.util';
import { finalizeEmailVerification } from './email-otp-finalize.util';
import { createEmailOtpRecord } from './email-otp-storage.util';
import { assertEmailOtpRequestAllowed } from './email-otp-rate-limit.util';
import { sendVerificationEmail } from './verification-email.util';
import { createCustomerPasswordResetRequest } from './password-reset-request.util';
import { consumePasswordResetIpAllowance } from './password-reset-ip-rate-limit.util';
import { sendPasswordResetEmail } from './password-reset-email.util';
import { generateSessionToken, getSessionExpiration, hashSessionToken } from './session-token.util';

export interface RegisterCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
}

@Injectable()
export class AuthServiceService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  getHello(): string {
    return 'Hello World!';
  }

  async registerCustomer(input: RegisterCustomerInput) {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Registration details are required');
    }

    const firstName =
      typeof input.firstName === 'string'
        ? input.firstName.trim()
        : '';

    const lastName =
      typeof input.lastName === 'string'
        ? input.lastName.trim()
        : '';

    const email =
      typeof input.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';

    const phone =
      typeof input.phone === 'string'
        ? input.phone.trim()
        : '';

    const password = input.password;

    if (!firstName || !lastName) {
      throw new BadRequestException(
        'First name and last name are required',
      );
    }

    if (firstName.length > 100 || lastName.length > 100) {
      throw new BadRequestException('Name is too long');
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new BadRequestException('A valid email is required');
    }

    if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number');
    }

    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128
    ) {
      throw new BadRequestException(
        'Password must contain 8 to 128 characters',
      );
    }

    const existingEmail = await this.db.orm.public.User
      .where({ email })
      .first();

    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    if (phone) {
      const existingPhone = await this.db.orm.public.User
        .where({ phone })
        .first();

      if (existingPhone) {
        throw new ConflictException('Phone number is already registered');
      }
    }

    const passwordHash = await hashPassword(password);

    let user: any;

    try {
      user = await this.db.orm.public.User.create({
        firstName,
        lastName,
        email,
        phone: phone || null,
        passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '';

      if (
        /unique|duplicate|23505/i.test(message)
      ) {
        throw new ConflictException(
          'Email or phone number is already registered',
        );
      }

      throw error;
    }

    let verificationEmailSent = false;

    try {
      const otp = await createEmailOtpRecord(this.db, user.id);
      await sendVerificationEmail(email, otp.code);
      verificationEmailSent = true;
    } catch {
      // The customer already exists. Do not expose email-provider errors
      // or incorrectly report that account creation failed.
      verificationEmailSent = false;
    }
    return {
      message: verificationEmailSent
        ? 'Customer account created. Check your email for the verification code.'
        : 'Customer account created. Verification email could not be sent. Please request a new code later.',
      verificationEmailSent,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    };
  }

  async resendCustomerEmailOtp(input: { email: string }) {
    const email =
      typeof input?.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email address is required');
    }

    const genericMessage =
      'If this account requires verification, a new code will be sent if permitted.';

    const user = await this.db.orm.public.User.where({ email }).first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.emailVerifiedAt !== null
    ) {
      return { message: genericMessage };
    }

    const otp = await this.db.transaction(async (tx: any) => {
      // Lock by customer ID to serialize concurrent resend requests.
      // The lock is automatically released when the transaction ends.
      const lockPlan = this.db.raw.sql`
        SELECT 1::int4 AS acquired
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtext('rimflex:customer-email-otp'),
            hashtext(${user.id})
          )
        ) AS lock_result
      `.returnsRow({
        acquired: 'pg/int4@1',
      }).build();

      const lockRows = await tx.query(lockPlan);

      if (
        lockRows.length !== 1 ||
        lockRows[0]?.acquired !== 1
      ) {
        throw new Error('Could not acquire email OTP resend lock.');
      }

      // Recheck after acquiring the lock; the account may have
      // been verified while this request was waiting.
      const currentUser = await tx.orm.public.User
        .where({ id: user.id })
        .first();

      if (
        !currentUser ||
        currentUser.role !== 'CUSTOMER' ||
        currentUser.emailVerifiedAt !== null
      ) {
        return null;
      }

      const previousRequests =
        await tx.orm.public.EmailVerificationCode
          .where({ userId: currentUser.id })
          .all();

      assertEmailOtpRequestAllowed(previousRequests);

      return await createEmailOtpRecord(tx, currentUser.id);
    });

    if (!otp) {
      return { message: genericMessage };
    }

    // Email delivery happens outside the transaction so network
    // delays do not keep the customer advisory lock held.
    try {
      await sendVerificationEmail(email, otp.code);
    } catch {
      throw new BadRequestException(
        'Verification email could not be sent. Please try again later.'
      );
    }

    return { message: genericMessage };
  }
  async verifyCustomerEmail(input: { email: string; code: string }) {
    const email =
      typeof input?.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';

    const code = input?.code;

    if (
      !email ||
      typeof code !== 'string' ||
      !/^[0-9]{6}$/.test(code)
    ) {
      throw new BadRequestException('Valid email and six-digit code required');
    }

    const user = await this.db.orm.public.User
      .where({ email })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.emailVerifiedAt !== null
    ) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const records = await this.db.orm.public.EmailVerificationCode
      .where({ userId: user.id })
      .all();

    const latest = [...records].sort(
      (a: any, b: any) =>
        Temporal.Instant.compare(b.createdAt, a.createdAt),
    )[0];

    if (!latest) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    let correct = false;

    try {
      correct = isEmailOtpCorrect(latest, code);
    } catch {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (!correct) {
      await recordFailedEmailOtpAttempt(
        this.db,
        latest.id,
        user.id,
      );

      throw new BadRequestException('Invalid or expired verification code');
    }

    const verified = await finalizeEmailVerification(
      this.db,
      latest.id,
      user.id,
    );

    if (!verified) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    return { message: 'Email verified successfully' };
  }
  async loginCustomer(input: {
    email: string;
    password: string;
  }) {
    if (!input || typeof input !== 'object') {
      throw new UnauthorizedException('Invalid email or password');
    }

    const email =
      typeof input.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';

    const password = input.password;

    if (
      !email ||
      email.length > 254 ||
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > 128
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.db.orm.public.User
      .where({ email })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.status !== 'ACTIVE' ||
      user.emailVerifiedAt === null
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const validPassword = await verifyPassword(
      password,
      user.passwordHash,
    );

    if (!validPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const sessionToken = generateSessionToken();

    await this.db.transaction(async (tx: any) => {
      // Coordinate session creation with password-reset finalization.
      const lockPlan = this.db.raw.sql`
        SELECT 1::int4 AS acquired
        FROM (
          SELECT pg_advisory_xact_lock(
            hashtext('rimflex:customer-password-reset'),
            hashtext(${user.id})
          )
        ) AS lock_result
      `.returnsRow({
        acquired: 'pg/int4@1',
      }).build();

      const lockRows = await tx.query(lockPlan);

      if (
        lockRows.length !== 1 ||
        lockRows[0]?.acquired !== 1
      ) {
        throw new Error('Could not acquire customer login lock');
      }

      const currentUser = await tx.orm.public.User
        .where({ id: user.id })
        .first();

      if (
        !currentUser ||
        currentUser.role !== 'CUSTOMER' ||
        currentUser.status !== 'ACTIVE' ||
        currentUser.emailVerifiedAt === null ||
        currentUser.passwordHash !== user.passwordHash
      ) {
        throw new UnauthorizedException('Invalid email or password');
      }

      await tx.orm.public.AuthSession.create({
        id: randomUUID(),
        userId: currentUser.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt: getSessionExpiration(),
      });
    });

    return {
      sessionToken,
      message: 'Customer credentials verified successfully',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    };
  }

  async validateCustomerSession(sessionToken: string) {
    if (
      typeof sessionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)
    ) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const tokenHash = hashSessionToken(sessionToken);

    const session = await this.db.orm.public.AuthSession
      .where({ tokenHash })
      .first();

    if (
      !session ||
      session.revokedAt !== null ||
      Temporal.Instant.compare(
        session.expiresAt,
        Temporal.Now.instant(),
      ) <= 0
    ) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.db.orm.public.User
      .where({ id: session.userId })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
    };
  }

  async requestCustomerPasswordReset(
    input: { email: string },
    clientIp: string,
  ) {
    const genericMessage =
      'If an eligible account exists, a password reset link will be sent.';

    const genericResponse = { message: genericMessage };

    const allowed = await consumePasswordResetIpAllowance(
      this.db,
      clientIp,
    );

    if (!allowed) {
      return genericResponse;
    }

    const email =
      typeof input?.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new BadRequestException('A valid email address is required');
    }

    const user = await this.db.orm.public.User
      .where({ email })
      .first();

    if (
      !user ||
      user.role !== 'CUSTOMER' ||
      user.status !== 'ACTIVE' ||
      user.emailVerifiedAt === null
    ) {
      return genericResponse;
    }

    const token = await createCustomerPasswordResetRequest(
      this.db,
      user.id,
    );

    if (!token) {
      return genericResponse;
    }

    // Network requests must not hold a database transaction open.
    // Never expose email-delivery errors or reset tokens to callers.
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch {
      // Delivery failures are intentionally indistinguishable from
      // requests for unknown, ineligible, or rate-limited accounts.
      // Operational logging can be added without recording tokens.
    }

    return genericResponse;
  }
  async revokeCustomerSession(sessionToken: string) {
    if (
      typeof sessionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)
    ) {
      return { message: 'Logged out successfully' };
    }

    const tokenHash = hashSessionToken(sessionToken);

    const session = await this.db.orm.public.AuthSession
      .where({ tokenHash })
      .first();

    if (session && session.revokedAt === null) {
      await this.db.orm.public.AuthSession
        .where({ id: session.id })
        .update({
          revokedAt: Temporal.Now.instant(),
        });
    }

    return { message: 'Logged out successfully' };
  }
}
