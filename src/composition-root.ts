import type { Express } from 'express';
import type { Config } from './config';
import { createApp } from './infrastructure/http/app';
import { createPrismaClient } from './infrastructure/persistence/prisma-client';
import { ConsoleLogger, type Logger } from './shared';

export interface Container {
  config: Config;
  logger: Logger;
  app: Express;
  shutdown: () => Promise<void>;
}

/**
 * Composition root: singurul loc unde se aleg implementarile concrete si se asambleaza
 * dependentele (DI manual). Modulele noi isi inregistreaza aici adaptoarele.
 */
export function createContainer(config: Config): Container {
  const logger = new ConsoleLogger(config.LOG_LEVEL);
  const prisma = createPrismaClient(config.DATABASE_URL);

  const app = createApp({
    logger,
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  });

  return {
    config,
    logger,
    app,
    shutdown: async () => {
      await prisma.$disconnect();
    },
  };
}
