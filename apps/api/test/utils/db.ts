import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { GAME_CATALOG } from '../../prisma/games.js';

/** Truncates every table and re-seeds the game catalog. */
export async function resetDb(app: INestApplication): Promise<PrismaService> {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await prisma.game.createMany({ data: [...GAME_CATALOG] });
  return prisma;
}
