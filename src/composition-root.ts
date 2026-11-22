import type { Express } from 'express';
import type { Config } from './config';
import { createApp } from './infrastructure/http/app';
import { createPrismaClient, type PrismaClient } from './infrastructure/persistence/prisma-client';
import { createCatalogRouter } from './modules/catalog/adapters/http/catalog.routes';
import { CachingProductRepository } from './modules/catalog/adapters/persistence/CachingProductRepository';
import { InMemoryBundleRepository } from './modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryCategoryRepository } from './modules/catalog/adapters/persistence/InMemoryCategoryRepository';
import { InMemoryProductRepository } from './modules/catalog/adapters/persistence/InMemoryProductRepository';
import { PrismaBundleRepository } from './modules/catalog/adapters/persistence/PrismaBundleRepository';
import { PrismaCategoryRepository } from './modules/catalog/adapters/persistence/PrismaCategoryRepository';
import { PrismaProductRepository } from './modules/catalog/adapters/persistence/PrismaProductRepository';
import { CatalogQueryService } from './modules/catalog/application/CatalogQueryService';
import type { BundleRepository } from './modules/catalog/ports/out/BundleRepository';
import type { CategoryRepository } from './modules/catalog/ports/out/CategoryRepository';
import type { ProductRepository } from './modules/catalog/ports/out/ProductRepository';
import { ConsoleLogger, type Logger } from './shared';

export interface Container {
  config: Config;
  logger: Logger;
  app: Express;
  shutdown: () => Promise<void>;
}

/** Porturile de persistenta ale aplicatiei; fiecare se poate asambla din adaptoare diferite. */
export interface Repositories {
  products: ProductRepository;
  categories: CategoryRepository;
  bundles: BundleRepository;
}

/** Adaptoare in-memory: pornesc fara baza de date (teste, demo rapid). */
export function createInMemoryRepositories(): Repositories {
  const products = new InMemoryProductRepository();
  return {
    products,
    categories: new InMemoryCategoryRepository(),
    bundles: new InMemoryBundleRepository(products),
  };
}

/** Adaptoare Prisma/PostgreSQL; citirile de produse trec printr-un proxy cu cache. */
export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    products: new CachingProductRepository(new PrismaProductRepository(prisma)),
    categories: new PrismaCategoryRepository(prisma),
    bundles: new PrismaBundleRepository(prisma),
  };
}

export interface ApplicationDependencies {
  logger: Logger;
  repositories: Repositories;
  checkDatabase: () => Promise<void>;
}

/**
 * Asambleaza aplicatia HTTP din porturile de persistenta primite: aceeasi cablare ruleaza
 * in productie (Prisma) si in teste (in-memory), deci testele exercita codul real.
 */
export function createApplication({
  logger,
  repositories,
  checkDatabase,
}: ApplicationDependencies): Express {
  const catalogQueries = new CatalogQueryService(
    repositories.products,
    repositories.categories,
    repositories.bundles,
  );

  return createApp({
    logger,
    checkDatabase,
    routers: [createCatalogRouter({ queries: catalogQueries })],
  });
}

/**
 * Composition root: singurul loc unde se aleg implementarile concrete si se asambleaza
 * dependentele (DI manual). Modulele noi isi inregistreaza aici adaptoarele.
 */
export function createContainer(config: Config): Container {
  const logger = new ConsoleLogger(config.LOG_LEVEL);
  const prisma = createPrismaClient(config.DATABASE_URL);

  const app = createApplication({
    logger,
    repositories: createPrismaRepositories(prisma),
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
