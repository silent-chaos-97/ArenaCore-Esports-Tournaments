import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { resetDb } from './utils/db.js';

describe('database schema', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = await resetDb(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('seeds the game catalog', async () => {
    expect(await prisma.game.count()).toBe(5);
  });

  it('prevents one external game identity from being claimed twice', async () => {
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: 'valorant' } });
    const players = await Promise.all(
      ['a', 'b'].map((n) =>
        prisma.user.create({
          data: {
            email: `${n}@example.com`,
            passwordHash: 'x',
            displayName: n,
            player: { create: { displayName: n } },
          },
          include: { player: true },
        }),
      ),
    );
    const claim = (playerId: string) =>
      prisma.gameAccount.create({
        data: { playerId, gameId: game.id, externalPlayerId: 'riot#123', username: 'ace' },
      });
    await claim(players[0]!.player!.id);
    await expect(claim(players[1]!.player!.id)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});
