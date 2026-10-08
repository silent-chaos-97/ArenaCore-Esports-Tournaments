import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_ERROR_CODES, type ApiEnv, type AuthTokens } from '@arenacore/shared';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../../common/crypto/secret-box.js';
import type { AccessTokenClaims } from '../../common/auth/auth.types.js';
import { API_ENV } from '../../config/config.module.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface IssuedSession extends AuthTokens {
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

/** Refresh-token rotation with family-wide revocation on reuse. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async start(userId: string, mfa: boolean, client: ClientInfo): Promise<IssuedSession> {
    return this.issue(userId, randomUUID(), mfa, client);
  }

  async rotate(
    refreshToken: string,
    client: ClientInfo,
  ): Promise<IssuedSession & { userId: string }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    const invalid = () =>
      new UnauthorizedException({
        message: 'Session is no longer valid',
        code: AUTH_ERROR_CODES.SESSION_INVALID,
      });
    if (!session) throw invalid();
    if (session.rotatedAt || session.revokedAt) {
      // A rotated token was presented again: assume theft and kill the whole family.
      await this.revokeFamily(session.familyId);
      throw invalid();
    }
    if (session.expiresAt <= new Date()) throw invalid();

    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(session.familyId);
      throw invalid();
    }
    const mfa = session.mfa;
    const issued = await this.issue(session.userId, session.familyId, mfa, client);
    return { ...issued, userId: session.userId };
  }

  async revoke(refreshToken: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (session) await this.revokeFamily(session.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    userId: string,
    familyId: string,
    mfa: boolean,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + this.env.JWT_REFRESH_TTL_SECONDS * 1000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        mfa,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: client.userAgent?.slice(0, 255),
        ip: client.ip,
      },
    });
    const claims: AccessTokenClaims = { sub: userId, sid: session.id, mfa };
    const accessToken = await this.jwt.signAsync(claims);
    return {
      accessToken,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt,
    };
  }
}
