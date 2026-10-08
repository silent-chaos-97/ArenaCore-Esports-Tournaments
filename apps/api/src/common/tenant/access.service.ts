import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUTH_ERROR_CODES, MFA_REQUIRED_ROLES, type ApiEnv, type OrgRole } from '@arenacore/shared';
import { API_ENV } from '../../config/config.module.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { TenantContext } from './tenant.types.js';

export type TournamentAccess = TenantContext & {
  /** Set when access comes from a tournament-scoped staff assignment rather than an org role. */
  staffRole: 'ADMIN' | 'REFEREE' | null;
};

/**
 * Central authorization decisions: org membership (RBAC) plus resource-scoped grants.
 * Unknown or foreign resources yield 404 so tenants cannot probe each other.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async resolveMembership(
    user: AuthUser,
    orgId: string,
    allowed: readonly OrgRole[],
  ): Promise<TenantContext> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    });
    if (!membership) throw new NotFoundException('Organization not found');
    if (!allowed.includes(membership.role)) {
      throw new ForbiddenException(`Requires one of: ${allowed.join(', ')}`);
    }
    this.assertMfa(user, membership.role);
    return { orgId, userId: user.id, role: membership.role, membershipId: membership.id };
  }

  /**
   * Tournament-scoped check. Org members with an allowed role pass; otherwise a per-tournament
   * staff assignment (e.g. REFEREE for this tournament only) may grant access.
   */
  async assertTournamentAccess(
    user: AuthUser,
    tournamentId: string,
    allowedOrgRoles: readonly OrgRole[],
    allowedStaffRoles: readonly ('ADMIN' | 'REFEREE')[] = [],
  ): Promise<TournamentAccess> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        organizationId: true,
        organization: { select: { members: { where: { userId: user.id } } } },
        staff: { where: { userId: user.id } },
      },
    });
    const membership = tournament?.organization.members[0];
    if (!tournament || !membership) throw new NotFoundException('Tournament not found');
    const ctx = {
      orgId: tournament.organizationId,
      userId: user.id,
      role: membership.role,
      membershipId: membership.id,
    };
    if (allowedOrgRoles.includes(membership.role)) {
      this.assertMfa(user, membership.role);
      return { ...ctx, staffRole: null };
    }
    const staff = tournament.staff[0];
    if (staff && allowedStaffRoles.includes(staff.role)) {
      if (staff.role === 'ADMIN') this.assertMfa(user, 'ADMIN');
      return { ...ctx, staffRole: staff.role };
    }
    throw new ForbiddenException('You are not authorized for this tournament');
  }

  private assertMfa(user: AuthUser, role: OrgRole): void {
    if (this.env.MFA_ENFORCED && MFA_REQUIRED_ROLES.includes(role) && !user.mfa) {
      throw new ForbiddenException({
        message: 'Owners and admins must sign in with MFA',
        code: AUTH_ERROR_CODES.MFA_ENROLMENT_REQUIRED,
      });
    }
  }
}
