import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  slugify,
  type CreateTeamInput,
  type InviteTeamMemberInput,
  type TeamDto,
  type TeamInviteDto,
  type UpdateTeamInput,
  type UpdateTeamMemberInput,
} from '@arenacore/shared';
import { randomBytes } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import type { Player, Team, TeamInvite, TeamMember } from '../../generated/prisma/client.js';
import { PlayersService } from './players.service.js';

type TeamWithMembers = Team & { members: (TeamMember & { player: Player })[] };
const MANAGE_ROLES = ['CAPTAIN', 'MANAGER'] as const;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly outbox: OutboxService,
  ) {}

  async create(userId: string, input: CreateTeamInput): Promise<TeamDto> {
    const player = await this.players.playerForUser(userId);
    if (input.gameId && !(await this.prisma.game.findUnique({ where: { id: input.gameId } }))) {
      throw new NotFoundException('Game not found');
    }
    const team = await this.prisma.team.create({
      data: {
        name: input.name,
        tag: input.tag,
        gameId: input.gameId,
        slug: await this.uniqueSlug(input.name),
        captainId: player.id,
        members: { create: { playerId: player.id, role: 'CAPTAIN' } },
      },
      include: membersInclude,
    });
    return toTeam(team);
  }

  async mine(userId: string): Promise<TeamDto[]> {
    const player = await this.players.playerForUser(userId);
    const teams = await this.prisma.team.findMany({
      where: { status: 'ACTIVE', members: { some: { playerId: player.id, leftAt: null } } },
      include: membersInclude,
      orderBy: { createdAt: 'asc' },
    });
    return teams.map(toTeam);
  }

  async get(teamId: string): Promise<TeamDto> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: membersInclude,
    });
    if (!team) throw new NotFoundException('Team not found');
    return toTeam(team);
  }

  async update(userId: string, teamId: string, input: UpdateTeamInput): Promise<TeamDto> {
    await this.requireManager(userId, teamId);
    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { name: input.name, tag: input.tag, logoUrl: input.logoUrl },
      include: membersInclude,
    });
    return toTeam(team);
  }

  async invite(
    userId: string,
    teamId: string,
    input: InviteTeamMemberInput,
  ): Promise<TeamInviteDto> {
    await this.requireManager(userId, teamId);
    const invitee = await this.prisma.player.findFirst({ where: { user: { email: input.email } } });
    if (!invitee) throw new NotFoundException('No player is registered with that email');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({
        where: { teamId_playerId: { teamId, playerId: invitee.id } },
      });
      if (existing && !existing.leftAt)
        throw new DomainError('ALREADY_MEMBER', 'Player is already on this team', 409);
      const pending = await tx.teamInvite.findFirst({
        where: { teamId, playerId: invitee.id, status: 'PENDING' },
      });
      if (pending)
        throw new DomainError('INVITE_PENDING', 'Player already has a pending invite', 409);
      const inviter = await tx.player.findUniqueOrThrow({ where: { userId } });
      const invite = await tx.teamInvite.create({
        data: { teamId, playerId: invitee.id, invitedById: inviter.id, role: input.role },
        include: { team: true, player: true },
      });
      await this.outbox.emit(tx, {
        type: 'TeamInviteCreated',
        aggregateType: 'Team',
        aggregateId: teamId,
        payload: {
          inviteId: invite.id,
          teamId,
          teamName: invite.team.name,
          playerId: invitee.id,
          userId: invitee.userId,
        },
      });
      return toInvite(invite);
    });
  }

  async invitesForTeam(userId: string, teamId: string): Promise<TeamInviteDto[]> {
    await this.requireManager(userId, teamId);
    const invites = await this.prisma.teamInvite.findMany({
      where: { teamId, status: 'PENDING' },
      include: { team: true, player: true },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map(toInvite);
  }

  async myInvites(userId: string): Promise<TeamInviteDto[]> {
    const player = await this.players.playerForUser(userId);
    const invites = await this.prisma.teamInvite.findMany({
      where: { playerId: player.id, status: 'PENDING' },
      include: { team: true, player: true },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map(toInvite);
  }

  async respond(userId: string, inviteId: string, accept: boolean): Promise<TeamDto | null> {
    const player = await this.players.playerForUser(userId);
    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.teamInvite.findFirst({
        where: { id: inviteId, playerId: player.id },
      });
      if (!invite) throw new NotFoundException('Invite not found');
      const claimed = await tx.teamInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new DomainError('INVITE_INVALID', 'This invite is no longer pending', 410);
      if (!accept) return null;
      await tx.teamMember.upsert({
        where: { teamId_playerId: { teamId: invite.teamId, playerId: player.id } },
        update: { role: invite.role, active: true, leftAt: null, joinedAt: new Date() },
        create: { teamId: invite.teamId, playerId: player.id, role: invite.role },
      });
      return toTeam(
        await tx.team.findUniqueOrThrow({ where: { id: invite.teamId }, include: membersInclude }),
      );
    });
  }

  async revokeInvite(userId: string, teamId: string, inviteId: string): Promise<void> {
    await this.requireManager(userId, teamId);
    const revoked = await this.prisma.teamInvite.updateMany({
      where: { id: inviteId, teamId, status: 'PENDING' },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });
    if (revoked.count === 0) throw new NotFoundException('Invite not found');
  }

  /** Role changes, captaincy transfer (captain only) and active/inactive roster status. */
  async updateMember(
    userId: string,
    teamId: string,
    memberId: string,
    input: UpdateTeamMemberInput,
  ): Promise<TeamDto> {
    const actor = await this.requireManager(userId, teamId);
    return this.prisma.$transaction(async (tx) => {
      const member = await this.activeMember(tx, teamId, memberId);
      if (input.role === 'CAPTAIN' || member.role === 'CAPTAIN') {
        if (actor.role !== 'CAPTAIN')
          throw new ForbiddenException('Only the captain can transfer captaincy');
      }
      if (input.role === 'CAPTAIN' && member.role !== 'CAPTAIN') {
        await tx.teamMember.updateMany({
          where: { teamId, role: 'CAPTAIN' },
          data: { role: 'PLAYER' },
        });
        await tx.team.update({ where: { id: teamId }, data: { captainId: member.playerId } });
      } else if (member.role === 'CAPTAIN' && input.role && input.role !== 'CAPTAIN') {
        throw new DomainError(
          'CAPTAIN_REQUIRED',
          'Transfer captaincy to another member first',
          409,
        );
      }
      if (member.role === 'CAPTAIN' && input.active === false) {
        throw new DomainError('CAPTAIN_REQUIRED', 'The captain must stay active', 409);
      }
      await tx.teamMember.update({
        where: { id: member.id },
        data: { role: input.role, active: input.active },
      });
      return toTeam(
        await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: membersInclude }),
      );
    });
  }

  /** Managers remove members; any member may remove themselves (leave). */
  async removeMember(userId: string, teamId: string, memberId: string): Promise<void> {
    const player = await this.players.playerForUser(userId);
    await this.prisma.$transaction(async (tx) => {
      const member = await this.activeMember(tx, teamId, memberId);
      if (member.playerId !== player.id) await this.requireManager(userId, teamId);
      if (member.role === 'CAPTAIN') {
        throw new DomainError(
          'CAPTAIN_REQUIRED',
          'Transfer captaincy before leaving the team',
          409,
        );
      }
      await tx.teamMember.update({
        where: { id: member.id },
        data: { leftAt: new Date(), active: false },
      });
    });
  }

  /** Returns the caller's membership if they are the team's captain or manager. */
  async requireManager(userId: string, teamId: string): Promise<TeamMember> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.status !== 'ACTIVE') throw new NotFoundException('Team not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { teamId, leftAt: null, player: { userId } },
    });
    if (!membership || !(MANAGE_ROLES as readonly string[]).includes(membership.role)) {
      throw new ForbiddenException('Only the team captain or a manager can do this');
    }
    return membership;
  }

  private async activeMember(tx: Tx, teamId: string, memberId: string): Promise<TeamMember> {
    const member = await tx.teamMember.findFirst({ where: { id: memberId, teamId, leftAt: null } });
    if (!member) throw new NotFoundException('Team member not found');
    return member;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'team';
    if (!(await this.prisma.team.findUnique({ where: { slug: base } }))) return base;
    return `${base}-${randomBytes(3).toString('hex')}`;
  }
}

const membersInclude = {
  members: { where: { leftAt: null }, include: { player: true }, orderBy: { joinedAt: 'asc' } },
} as const;

function toTeam(team: TeamWithMembers): TeamDto {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    tag: team.tag,
    logoUrl: team.logoUrl,
    gameId: team.gameId,
    captainId: team.captainId,
    status: team.status,
    members: team.members.map((m) => ({
      id: m.id,
      playerId: m.playerId,
      displayName: m.player.displayName,
      role: m.role,
      active: m.active,
      joinedAt: m.joinedAt.toISOString(),
    })),
  };
}

function toInvite(invite: TeamInvite & { team: Team; player: Player }): TeamInviteDto {
  return {
    id: invite.id,
    teamId: invite.teamId,
    teamName: invite.team.name,
    playerId: invite.playerId,
    playerName: invite.player.displayName,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
  };
}
