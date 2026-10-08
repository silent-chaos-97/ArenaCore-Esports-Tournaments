import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { GAME_CATALOG } from './games.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  for (const game of GAME_CATALOG) {
    await prisma.game.upsert({ where: { slug: game.slug }, update: game, create: game });
  }
  console.log(`Seeded ${GAME_CATALOG.length} games`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
