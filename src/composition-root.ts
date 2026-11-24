import type { Express } from 'express';
import type { Config } from './config';
import { createApp } from './infrastructure/http/app';
import { createAuthentication } from './infrastructure/http/authentication';
import { createPrismaClient, type PrismaClient } from './infrastructure/persistence/prisma-client';
import { CatalogItemLookup } from './modules/cart/adapters/catalog/CatalogItemLookup';
import { createCartRouter } from './modules/cart/adapters/http/cart.routes';
import { InMemoryCartRepository } from './modules/cart/adapters/persistence/InMemoryCartRepository';
import { PrismaCartRepository } from './modules/cart/adapters/persistence/PrismaCartRepository';
import { CartService } from './modules/cart/application/CartService';
import type { CartRepository } from './modules/cart/ports/out/CartRepository';
import { createCatalogRouter } from './modules/catalog/adapters/http/catalog.routes';
import { CachingProductRepository } from './modules/catalog/adapters/persistence/CachingProductRepository';
import { InMemoryBundleRepository } from './modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryCategoryRepository } from './modules/catalog/adapters/persistence/InMemoryCategoryRepository';
import { InMemoryProductRepository } from './modules/catalog/adapters/persistence/InMemoryProductRepository';
import { PrismaBundleRepository } from './modules/catalog/adapters/persistence/PrismaBundleRepository';
import { PrismaCategoryRepository } from './modules/catalog/adapters/persistence/PrismaCategoryRepository';
import { PrismaProductRepository } from './modules/catalog/adapters/persistence/PrismaProductRepository';
import { AuthorizationProxy } from './modules/catalog/application/AuthorizationProxy';
import { CatalogAdminUseCases } from './modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from './modules/catalog/application/CatalogQueryService';
import type { BundleRepository } from './modules/catalog/ports/out/BundleRepository';
import type { CategoryRepository } from './modules/catalog/ports/out/CategoryRepository';
import type { ProductRepository } from './modules/catalog/ports/out/ProductRepository';
import { createAuthRouter } from './modules/identity/adapters/http/auth.routes';
import { InMemoryUserRepository } from './modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from './modules/identity/adapters/persistence/PrismaUserRepository';
import { BcryptPasswordHasher } from './modules/identity/adapters/security/BcryptPasswordHasher';
import { JwtTokenService } from './modules/identity/adapters/security/JwtTokenService';
import { AuthService } from './modules/identity/application/AuthService';
import type { UserRepository } from './modules/identity/ports/out/UserRepository';
import { createOrdersRouter } from './modules/ordering/adapters/http/orders.routes';
import { CartServiceSource } from './modules/ordering/adapters/cart/CartServiceSource';
import { CatalogOrderLookup } from './modules/ordering/adapters/catalog/CatalogOrderLookup';
import { InMemoryOrderPlacement } from './modules/ordering/adapters/persistence/InMemoryOrderPlacement';
import { InMemoryOrderRepository } from './modules/ordering/adapters/persistence/InMemoryOrderRepository';
import { PrismaOrderPlacement } from './modules/ordering/adapters/persistence/PrismaOrderPlacement';
import { PrismaOrderRepository } from './modules/ordering/adapters/persistence/PrismaOrderRepository';
import { OrderService } from './modules/ordering/application/OrderService';
import type { OrderPlacement } from './modules/ordering/ports/out/OrderPlacement';
import type { OrderRepository } from './modules/ordering/ports/out/OrderRepository';
import { ConsoleLogger, RandomUuidGenerator, type IdGenerator, type Logger } from './shared';

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
  users: UserRepository;
  carts: CartRepository;
  orders: OrderRepository;
  /** Plasarea atomica a comenzilor (stoc + comanda + cos); depinde de adaptoarele de mai sus. */
  orderPlacement: OrderPlacement;
}

/** Adaptoare in-memory: pornesc fara baza de date (teste, demo rapid). */
export function createInMemoryRepositories(): Repositories {
  const products = new InMemoryProductRepository();
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  return {
    products,
    categories: new InMemoryCategoryRepository(),
    bundles: new InMemoryBundleRepository(products),
    users: new InMemoryUserRepository(),
    carts,
    orders,
    orderPlacement: new InMemoryOrderPlacement(orders, products, carts),
  };
}

/** Adaptoare Prisma/PostgreSQL; citirile de produse trec printr-un proxy cu cache. */
export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  const products = new CachingProductRepository(new PrismaProductRepository(prisma));
  return {
    products,
    categories: new PrismaCategoryRepository(prisma),
    bundles: new PrismaBundleRepository(prisma),
    users: new PrismaUserRepository(prisma),
    carts: new PrismaCartRepository(prisma),
    orders: new PrismaOrderRepository(prisma),
    // Plasarea unei comenzi scade stocul direct in baza de date, pe langa proxy: invalidam cache-ul.
    orderPlacement: new PrismaOrderPlacement(prisma, (ids) => products.evict(ids)),
  };
}

export interface SecuritySettings {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  bcryptRounds: number;
  /** Limita de cereri per IP pentru /auth/register si /auth/login. */
  authRateLimit: { windowMs: number; max: number };
}

export interface ApplicationDependencies {
  logger: Logger;
  repositories: Repositories;
  security: SecuritySettings;
  checkDatabase: () => Promise<void>;
  /** Generatorul de id-uri (implicit UUID aleatoriu; testele pot injecta unul determinist). */
  ids?: IdGenerator;
}

/**
 * Asambleaza aplicatia HTTP din porturile de persistenta primite: aceeasi cablare ruleaza
 * in productie (Prisma) si in teste (in-memory), deci testele exercita codul real.
 */
export function createApplication({
  logger,
  repositories,
  security,
  checkDatabase,
  ids = new RandomUuidGenerator(),
}: ApplicationDependencies): Express {
  // Identity
  const tokens = new JwtTokenService(security.jwtSecret, security.jwtExpiresInSeconds);
  const hasher = new BcryptPasswordHasher(security.bcryptRounds);
  const auth = new AuthService(
    repositories.users,
    hasher,
    tokens,
    ids,
    logger.child({ module: 'identity' }),
  );
  const authentication = createAuthentication(tokens);

  // Catalog
  const catalogQueries = new CatalogQueryService(
    repositories.products,
    repositories.categories,
    repositories.bundles,
  );
  const catalogAdmin = new CatalogAdminUseCases(
    repositories.products,
    repositories.categories,
    repositories.bundles,
    ids,
    logger.child({ module: 'catalog' }),
  );

  // Cart
  const cart = new CartService(repositories.carts, new CatalogItemLookup(catalogQueries), ids);

  // Ordering
  const orders = new OrderService(
    repositories.orders,
    new CartServiceSource(cart),
    new CatalogOrderLookup(catalogQueries),
    repositories.orderPlacement,
    ids,
    logger.child({ module: 'ordering' }),
  );

  return createApp({
    logger,
    checkDatabase,
    middlewares: [authentication.authenticate],
    routers: [
      createAuthRouter({
        auth,
        requireAuth: authentication.requireAuth,
        rateLimit: security.authRateLimit,
      }),
      createCatalogRouter({
        queries: catalogQueries,
        admin: {
          // Doua straturi de aparare: middleware-ul HTTP (rol ADMIN) si AuthorizationProxy (Proxy S4).
          guards: [authentication.requireRole('ADMIN')],
          serviceFor: (req) =>
            new AuthorizationProxy(
              catalogAdmin,
              req.principal ?? null,
              logger.child({ module: 'catalog' }),
            ),
        },
      }),
      createCartRouter({ cart, requireAuth: authentication.requireAuth }),
      createOrdersRouter({
        orders,
        requireAuth: authentication.requireAuth,
        requireAdmin: authentication.requireRole('ADMIN'),
      }),
    ],
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
    security: {
      jwtSecret: config.JWT_SECRET,
      jwtExpiresInSeconds: config.JWT_EXPIRES_IN_SECONDS,
      bcryptRounds: config.BCRYPT_ROUNDS,
      authRateLimit: {
        windowMs: config.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
        max: config.AUTH_RATE_LIMIT_MAX,
      },
    },
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
