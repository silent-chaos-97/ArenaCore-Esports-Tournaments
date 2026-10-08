import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  type ApiEnv,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
} from '@arenacore/shared';
import { DomainError } from '../../common/errors/domain-error.js';
import { API_ENV } from '../../config/config.module.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { type IssuedSession, SessionService } from './session.service.js';

interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async register(input: RegisterInput, client: ClientInfo): Promise<IssuedSession> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing)
      throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists', 409);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await this.passwords.hash(input.password),
        displayName: input.displayName,
        player: { create: { displayName: input.displayName } },
      },
    });
    return this.sessions.start(user.id, false, client);
  }

  async login(input: LoginInput, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      });
    }
    if (user.mfaEnabledAt && user.mfaSecret) {
      if (!input.mfaCode) {
        throw new UnauthorizedException({
          message: 'A one-time code is required',
          code: AUTH_ERROR_CODES.MFA_REQUIRED,
        });
      }
      if (!(await this.mfa.verifyCode(user.mfaSecret, input.mfaCode))) {
        throw new UnauthorizedException({
          message: 'Invalid one-time code',
          code: AUTH_ERROR_CODES.MFA_INVALID,
        });
      }
      return this.sessions.start(user.id, true, client);
    }
    return this.sessions.start(user.id, false, client);
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        player: true,
        memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      mfaEnabled: user.mfaEnabledAt !== null,
      playerId: user.player?.id ?? null,
      memberships: user.memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: m.role,
      })),
    };
  }

  async beginMfaSetup(
    userId: string,
  ): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt)
      throw new DomainError('MFA_ALREADY_ENABLED', 'MFA is already enabled', 409);
    const enrolment = await this.mfa.createEnrolment(user.email);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: enrolment.sealedSecret },
    });
    return {
      secret: enrolment.secret,
      otpauthUrl: enrolment.otpauthUrl,
      qrDataUrl: enrolment.qrDataUrl,
    };
  }

  /** Confirms enrolment and upgrades to an MFA session; other sessions are revoked. */
  async enableMfa(userId: string, code: string, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt)
      throw new DomainError('MFA_ALREADY_ENABLED', 'MFA is already enabled', 409);
    if (!user.mfaSecret) throw new DomainError('MFA_NOT_STARTED', 'Start MFA setup first', 409);
    if (!(await this.mfa.verifyCode(user.mfaSecret, code))) {
      throw new UnauthorizedException({
        message: 'Invalid one-time code',
        code: AUTH_ERROR_CODES.MFA_INVALID,
      });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } });
    await this.sessions.revokeAllForUser(userId);
    return this.sessions.start(userId, true, client);
  }

  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.mfaSecret)
      throw new DomainError('MFA_NOT_ENABLED', 'MFA is not enabled', 409);
    if (!(await this.mfa.verifyCode(user.mfaSecret, code))) {
      throw new UnauthorizedException({
        message: 'Invalid one-time code',
        code: AUTH_ERROR_CODES.MFA_INVALID,
      });
    }
    const privileged = await this.prisma.organizationMember.count({
      where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    });
    if (privileged > 0 && this.env.MFA_ENFORCED) {
      throw new ForbiddenException({
        message: 'Owners and admins must keep MFA enabled',
        code: AUTH_ERROR_CODES.MFA_ENROLMENT_REQUIRED,
      });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabledAt: null, mfaSecret: null },
    });
    await this.sessions.revokeAllForUser(userId);
  }
}
