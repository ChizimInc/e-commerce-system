import 'dotenv/config';
import { loadConfig } from '../src/config';
import { createPrismaClient } from '../src/infrastructure/persistence/prisma-client';
import { PrismaUserRepository } from '../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { BcryptPasswordHasher } from '../src/modules/identity/adapters/security/BcryptPasswordHasher';
import { BootstrapAdmin } from '../src/modules/identity/application/BootstrapAdmin';
import { ConsoleLogger, RandomUuidGenerator } from '../src/shared';

/**
 * Seed: creeaza contul de administrator (ADMIN nu se poate crea prin API-ul public).
 * Email din SEED_ADMIN_EMAIL, parola din SEED_ADMIN_PASSWORD (obligatorie, nu exista valoare implicita).
 * Este idempotent. Datele demo (produse, categorii) se adauga in Iteratia 7 (vezi docs/PLAN.md).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger(config.LOG_LEVEL);
  const email = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@example.com';
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (!password) {
    throw new Error('Seed: seteaza SEED_ADMIN_PASSWORD in .env (minim 8 caractere).');
  }

  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    const bootstrap = new BootstrapAdmin(
      new PrismaUserRepository(prisma),
      new BcryptPasswordHasher(config.BCRYPT_ROUNDS),
      new RandomUuidGenerator(),
    );
    const outcome = await bootstrap.execute(email, password);
    logger.info(
      outcome === 'created' ? 'Seed: administrator creat' : 'Seed: administratorul exista deja',
      { email },
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
