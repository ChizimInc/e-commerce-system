import 'dotenv/config';
import { loadConfig } from '../src/config';
import { createPrismaClient } from '../src/infrastructure/persistence/prisma-client';
import { ConsoleLogger } from '../src/shared';

/**
 * Seed pentru date demo. Deocamdata nu insereaza nimic: datele demo (utilizatori, produse,
 * categorii) se adauga in iteratiile urmatoare (vezi docs/PLAN.md, Iteratia 7).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger(config.LOG_LEVEL);
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    const users = await prisma.user.count();
    logger.info('Seed: nu exista date demo de inserat inca', { users });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
