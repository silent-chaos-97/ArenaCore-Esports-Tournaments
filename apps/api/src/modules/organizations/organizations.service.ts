import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  slugify,
  type AuditEntryDto,
  type AuditQuery,
  type CreateOrganizationInput,
  type InviteStaffInput,
  type MemberDto,
  type OrganizationDto,
  type OrgRole,
  type Page,
} from '@arenacore/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service.js';
import { randomToken, sha256 } from '../../common/crypto/secret-box.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { TenantContext } from '../../common/tenant/tenant.types.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** AUTH-03: creates an isolated workspace with the caller as Owner. */
  async create(userId: string, input: CreateOrganizationInput): Promise<OrganizationDto> {
    const slug = input.slug ?? (await this.uniqueSlug(input.name));
    return this.prisma.$transaction(async (tx) => {
      if (await tx.organization.findUnique({ where: { slug } })) {
        throw new DomainError('SLUG_TAKEN', 'That organization URL is already taken', 409);
      }
      const org = await tx.organization.create({
        data: { name: input.name, slug, members: { create: { userId, role: 'OWNER' } } },
      });
      await this.audit.record(tx, {
        organizationId: org.id,
        actorId: userId,
        action: 'organization.created',
        entity: 'Organization',
        entityId: org.id,
        newValue: { name: org.name, slug: org.slug },
      });
      return { id: org.id, name: org.name, slug: org.slug, role: 'OWNER' };
    });
  }

  async listForUser(userId: string): Promise<OrganizationDto[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));
  }

  async get(tenant: TenantContext): Promise<OrganizationDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: tenant.orgId } });
    return { id: org.id, name: org.name, slug: org.slug, role: tenant.role };
  }

  async rename(tenant: TenantContext, name: string): Promise<OrganizationDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: tenant.orgId } });
      const org = await tx.organization.update({ where: { id: tenant.orgId }, data: { name } });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'organization.renamed',
        entity: 'Organization',
        entityId: org.id,
        oldValue: { name: before.name },
        newValue: { name },
      });
      return { id: org.id, name: org.name, slug: org.slug, role: tenant.role };
    });
  }

  async members(tenant: TenantContext): Promise<MemberDto[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: tenant.orgId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      role: m.role,
      mfaEnabled: m.user.mfaEnabledAt !== null,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async changeRole(tenant: TenantContext, memberId: string, role: OrgRole): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: tenant.orgId },
      });
      if (!member) throw new NotFoundException('Member not found');
      if (member.role === role) return;
      if (member.role === 'OWNER' && role !== 'OWNER')
        await this.assertNotLastOwner(tx, tenant.orgId);
      await tx.organizationMember.update({ where: { id: member.id }, data: { role } });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'member.role_changed',
        entity: 'OrganizationMember',
        entityId: member.id,
        oldValue: { role: member.role },
        newValue: { role },
      });
    });
  }

  async removeMember(tenant: TenantContext, memberId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId: tenant.orgId },
      });
      if (!member) throw new NotFoundException('Member not found');
      if (member.role === 'OWNER') {
        if (tenant.role !== 'OWNER') throw new ForbiddenException('Only owners can remove owners');
        await this.assertNotLastOwner(tx, tenant.orgId);
      }
      await tx.organizationMember.delete({ where: { id: member.id } });
      await tx.tournamentStaff.deleteMany({
        where: { userId: member.userId, tournament: { organizationId: tenant.orgId } },
      });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'member.removed',
        entity: 'OrganizationMember',
        entityId: member.id,
        oldValue: { userId: member.userId, role: member.role },
      });
    });
  }

  /** AUTH-05: returns the one-time token so it can be delivered (email) or shared by the inviter. */
  async invite(
    tenant: TenantContext,
    input: InviteStaffInput,
  ): Promise<{ id: string; email: string; role: OrgRole; token: string; expiresAt: string }> {
    if (input.role === 'OWNER' && tenant.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can invite owners');
    }
    const token = randomToken();
    return this.prisma.$transaction(async (tx) => {
      const alreadyMember = await tx.organizationMember.findFirst({
        where: { organizationId: tenant.orgId, user: { email: input.email } },
      });
      if (alreadyMember)
        throw new DomainError('ALREADY_MEMBER', 'That user is already a member', 409);
      await tx.organizationInvite.updateMany({
        where: {
          organizationId: tenant.orgId,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      const invite = await tx.organizationInvite.create({
        data: {
          organizationId: tenant.orgId,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          invitedById: tenant.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'member.invited',
        entity: 'OrganizationInvite',
        entityId: invite.id,
        newValue: { email: input.email, role: input.role },
      });
      return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });
  }

  async pendingInvites(tenant: TenantContext) {
    const invites = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId: tenant.orgId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async revokeInvite(tenant: TenantContext, inviteId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.organizationInvite.updateMany({
        where: { id: inviteId, organizationId: tenant.orgId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) throw new NotFoundException('Invite not found');
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'member.invite_revoked',
        entity: 'OrganizationInvite',
        entityId: inviteId,
      });
    });
  }

  async acceptInvite(userId: string, token: string): Promise<OrganizationDto> {
    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.organizationInvite.findUnique({
        where: { tokenHash: sha256(token) },
        include: { organization: true },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= new Date()) {
        throw new DomainError('INVITE_INVALID', 'This invitation is invalid or has expired', 410);
      }
      if (invite.email !== user.email) {
        throw new ForbiddenException('This invitation was sent to a different email address');
      }
      const claimed = await tx.organizationInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new DomainError('INVITE_INVALID', 'This invitation was already used', 410);
      const member = await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
        update: {},
        create: { organizationId: invite.organizationId, userId, role: invite.role },
      });
      await this.audit.record(tx, {
        organizationId: invite.organizationId,
        actorId: userId,
        action: 'member.joined',
        entity: 'OrganizationMember',
        entityId: member.id,
        newValue: { role: member.role, inviteId: invite.id },
      });
      return {
        id: invite.organization.id,
        name: invite.organization.name,
        slug: invite.organization.slug,
        role: member.role,
      };
    });
  }

  async auditLog(tenant: TenantContext, query: AuditQuery): Promise<Page<AuditEntryDto>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: tenant.orgId,
        ...(query.entity ? { entity: query.entity } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.displayName]));
    return {
      items: page.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  private async assertNotLastOwner(tx: Tx, orgId: string): Promise<void> {
    const owners = await tx.organizationMember.count({
      where: { organizationId: orgId, role: 'OWNER' },
    });
    if (owners <= 1)
      throw new DomainError('LAST_OWNER', 'An organization must keep at least one owner', 409);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'org';
    const padded = base.length < 3 ? `${base}-org` : base;
    if (!(await this.prisma.organization.findUnique({ where: { slug: padded } }))) return padded;
    return `${padded}-${randomBytes(3).toString('hex')}`;
  }
}
