import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { Audience } from './templates.js';

@Injectable()
export class RecipientResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(audiences: Audience[]): Promise<string[]> {
    const ids = new Set<string>();
    for (const audience of audiences) {
      for (const id of await this.one(audience)) ids.add(id);
    }
    return [...ids];
  }

  private async one(audience: Audience): Promise<string[]> {
    switch (audience.kind) {
      case 'user':
        return audience.userId ? [audience.userId] : [];
      case 'registration':
        return this.teamUsers({ registrations: { some: { id: audience.registrationId } } });
      case 'match':
        return this.teamUsers({
          participants: {
            some: {
              matchId: audience.matchId,
              ...(audience.onlyRegistrationId
                ? { registrationId: audience.onlyRegistrationId }
                : {}),
            },
          },
        });
      case 'orgStaff': {
        const members = await this.prisma.organizationMember.findMany({
          where: {
            organizationId: audience.organizationId,
            role: { in: ['OWNER', 'ADMIN', 'REFEREE'] },
          },
          select: { userId: true },
        });
        return members.map((m) => m.userId);
      }
    }
  }

  /** Active members of the matching teams. */
  private async teamUsers(teamWhere: object): Promise<string[]> {
    const members = await this.prisma.teamMember.findMany({
      where: { leftAt: null, active: true, team: teamWhere },
      select: { player: { select: { userId: true } } },
    });
    return members.map((m) => m.player.userId);
  }
}
