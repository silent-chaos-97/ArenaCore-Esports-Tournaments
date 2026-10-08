import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  GameAccountDto,
  GameDto,
  LinkGameAccountInput,
  PlayerProfileDto,
  UpdatePlayerInput,
} from '@arenacore/shared';
import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { Game, GameAccount, Player } from '../../generated/prisma/client.js';

/** Registration states during which a linked identity may not be removed. */
export const ACTIVE_REGISTRATION_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'CHECKED_IN',
] as const;

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async games(): Promise<GameDto[]> {
    const games = await this.prisma.game.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
    return games.map((g) => ({ id: g.id, slug: g.slug, name: g.name, platform: g.platform }));
  }

  async playerForUser(userId: string): Promise<Player> {
    const player = await this.prisma.player.findUnique({ where: { userId } });
    if (!player) throw new NotFoundException('Player profile not found');
    return player;
  }

  async profile(userId: string): Promise<PlayerProfileDto> {
    const player = await this.prisma.player.findUnique({
      where: { userId },
      include: { gameAccounts: { include: { game: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!player) throw new NotFoundException('Player profile not found');
    return toProfile(player);
  }

  async publicProfile(playerId: string): Promise<Omit<PlayerProfileDto, 'dateOfBirth'>> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { gameAccounts: { include: { game: true } } },
    });
    if (!player) throw new NotFoundException('Player not found');
    const { dateOfBirth: _hidden, ...rest } = toProfile(player);
    return rest;
  }

  async update(userId: string, input: UpdatePlayerInput): Promise<PlayerProfileDto> {
    const player = await this.playerForUser(userId);
    await this.prisma.player.update({
      where: { id: player.id },
      data: {
        displayName: input.displayName,
        country: input.country,
        dateOfBirth:
          input.dateOfBirth === undefined
            ? undefined
            : input.dateOfBirth && new Date(input.dateOfBirth),
      },
    });
    return this.profile(userId);
  }

  async linkAccount(userId: string, input: LinkGameAccountInput): Promise<GameAccountDto> {
    const player = await this.playerForUser(userId);
    const game = await this.prisma.game.findUnique({ where: { id: input.gameId } });
    if (!game?.active) throw new NotFoundException('Game not found');
    const claimed = await this.prisma.gameAccount.findUnique({
      where: {
        gameId_externalPlayerId: { gameId: game.id, externalPlayerId: input.externalPlayerId },
      },
    });
    if (claimed && claimed.playerId !== player.id) {
      throw new DomainError(
        'GAME_ACCOUNT_CLAIMED',
        'This game account is already linked to another player',
        409,
      );
    }
    const account = await this.prisma.gameAccount.upsert({
      where: { playerId_gameId: { playerId: player.id, gameId: game.id } },
      update: {
        externalPlayerId: input.externalPlayerId,
        username: input.username,
        region: input.region,
        verificationStatus: 'UNVERIFIED',
      },
      create: {
        playerId: player.id,
        gameId: game.id,
        externalPlayerId: input.externalPlayerId,
        username: input.username,
        region: input.region,
      },
      include: { game: true },
    });
    return toAccount(account);
  }

  async unlinkAccount(userId: string, accountId: string): Promise<void> {
    const player = await this.playerForUser(userId);
    const account = await this.prisma.gameAccount.findFirst({
      where: { id: accountId, playerId: player.id },
    });
    if (!account) throw new NotFoundException('Game account not found');
    const inUse = await this.prisma.registrationMember.count({
      where: {
        gameAccountId: account.id,
        registration: { status: { in: [...ACTIVE_REGISTRATION_STATUSES] } },
      },
    });
    if (inUse > 0) {
      throw new DomainError(
        'GAME_ACCOUNT_IN_USE',
        'This account is used by an active tournament registration',
        409,
      );
    }
    await this.prisma.gameAccount.delete({ where: { id: account.id } });
  }
}

function toAccount(a: GameAccount & { game: Game }): GameAccountDto {
  return {
    id: a.id,
    gameId: a.gameId,
    gameName: a.game.name,
    externalPlayerId: a.externalPlayerId,
    username: a.username,
    region: a.region,
    verificationStatus: a.verificationStatus,
  };
}

function toProfile(
  p: Player & { gameAccounts: (GameAccount & { game: Game })[] },
): PlayerProfileDto {
  return {
    id: p.id,
    userId: p.userId,
    displayName: p.displayName,
    country: p.country,
    dateOfBirth: p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    status: p.status,
    gameAccounts: p.gameAccounts.map(toAccount),
  };
}
