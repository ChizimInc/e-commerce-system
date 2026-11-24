import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createApplication,
  createInMemoryRepositories,
  type Repositories,
} from '../../src/composition-root';
import { createApp } from '../../src/infrastructure/http/app';
import { createCatalogRouter } from '../../src/modules/catalog/adapters/http/catalog.routes';
import { CachingProductRepository } from '../../src/modules/catalog/adapters/persistence/CachingProductRepository';
import { BcryptPasswordHasher } from '../../src/modules/identity/adapters/security/BcryptPasswordHasher';
import { BootstrapAdmin } from '../../src/modules/identity/application/BootstrapAdmin';
import { InMemoryBundleRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryProductRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryProductRepository';
import { AuthorizationProxy } from '../../src/modules/catalog/application/AuthorizationProxy';
import { CatalogAdminUseCases } from '../../src/modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from '../../src/modules/catalog/application/CatalogQueryService';
import { RandomUuidGenerator, type Principal } from '../../src/shared';
import {
  TEST_JWT_SECRET,
  TEST_PASSWORD,
  TEST_WEBHOOK_SECRET,
  bearer,
  buildTestApp,
} from '../helpers/app';
import { silentLogger } from '../helpers/silent-logger';

describe('limita de cereri pe /auth', () => {
  const limitedApp = (max: number) =>
    createApplication({
      logger: silentLogger,
      repositories: createInMemoryRepositories(),
      security: {
        jwtSecret: TEST_JWT_SECRET,
        jwtExpiresInSeconds: 3600,
        bcryptRounds: 4,
        authRateLimit: { windowMs: 60_000, max },
      },
      checkDatabase: () => Promise.resolve(),
      payments: { webhookSecret: TEST_WEBHOOK_SECRET },
    });

  it('dupa limita, login-ul raspunde 429 (si nu mai ruleaza bcrypt)', async () => {
    const app = limitedApp(3);
    const attempt = () =>
      request(app)
        .post('/auth/login')
        .send({ email: 'nimeni@example.com', password: 'orice-parola' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } });
  });

  it('limita se aplica si pe inregistrare, iar restul rutelor nu sunt afectate', async () => {
    const app = limitedApp(2);
    for (const email of ['a@example.com', 'b@example.com']) {
      expect(
        (await request(app).post('/auth/register').send({ email, password: TEST_PASSWORD })).status,
      ).toBe(201);
    }
    expect(
      (
        await request(app)
          .post('/auth/register')
          .send({ email: 'c@example.com', password: TEST_PASSWORD })
      ).status,
    ).toBe(429);
    expect((await request(app).get('/products')).status).toBe(200);
  });
});

describe('AuthorizationProxy ca strat de aparare independent de middleware-ul HTTP', () => {
  function appWithoutHttpGuard(principal: Principal | null) {
    const repositories = createInMemoryRepositories();
    const queries = new CatalogQueryService(
      repositories.products,
      repositories.categories,
      repositories.bundles,
    );
    const admin = new CatalogAdminUseCases(
      repositories.products,
      repositories.categories,
      repositories.bundles,
      new RandomUuidGenerator(),
      silentLogger,
    );
    return createApp({
      logger: silentLogger,
      checkDatabase: () => Promise.resolve(),
      routers: [
        createCatalogRouter({
          queries,
          // fara garzi HTTP: doar proxy-ul decide
          admin: { guards: [], serviceFor: () => new AuthorizationProxy(admin, principal) },
        }),
      ],
    });
  }
  const body = { name: 'Mouse', price: { amount: 100, currency: 'RON' }, stock: 1 };

  it('refuza un CUSTOMER cu 403 chiar daca ruta nu are middleware de rol', async () => {
    const app = appWithoutHttpGuard({ userId: 'u', role: 'CUSTOMER' });
    expect((await request(app).post('/products').send(body)).status).toBe(403);
  });

  it('refuza un apelant anonim cu 401', async () => {
    expect((await request(appWithoutHttpGuard(null)).post('/products').send(body)).status).toBe(
      401,
    );
  });

  it('lasa sa treaca un ADMIN', async () => {
    const app = appWithoutHttpGuard({ userId: 'u', role: 'ADMIN' });
    expect((await request(app).post('/products').send(body)).status).toBe(201);
  });
});

describe('fluxul HTTP prin CachingProductRepository (Proxy cu cache)', () => {
  it('citirile repetate raman corecte, iar scrierile admin se vad imediat', async () => {
    // Aceeasi cablare ca in productie: produsele trec prin proxy-ul cu cache.
    const products = new CachingProductRepository(new InMemoryProductRepository());
    const base = createInMemoryRepositories();
    const repositories: Repositories = {
      ...base,
      products,
      bundles: new InMemoryBundleRepository(products),
    };
    const app = createApplication({
      logger: silentLogger,
      repositories,
      security: {
        jwtSecret: TEST_JWT_SECRET,
        jwtExpiresInSeconds: 3600,
        bcryptRounds: 4,
        authRateLimit: { windowMs: 60_000, max: 1000 },
      },
      checkDatabase: () => Promise.resolve(),
      payments: { webhookSecret: TEST_WEBHOOK_SECRET },
    });
    await new BootstrapAdmin(
      repositories.users,
      new BcryptPasswordHasher(4),
      new RandomUuidGenerator(),
    ).execute('admin@cache.test', TEST_PASSWORD);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@cache.test', password: TEST_PASSWORD });
    const token = (login.body as { accessToken: string }).accessToken;

    const created = await request(app)
      .post('/products')
      .set(...bearer(token))
      .send({ name: 'Cache test', price: { amount: 100, currency: 'RON' }, stock: 5 });
    const id = (created.body as { id: string }).id;
    const total = async () =>
      ((await request(app).get('/products')).body as { total: number }).total;

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get(`/products/${id}`)).body).toMatchObject({ stock: 5 });
      expect(await total()).toBe(1);
    }

    await request(app)
      .patch(`/products/${id}`)
      .set(...bearer(token))
      .send({ stock: 9 });
    expect((await request(app).get(`/products/${id}`)).body).toMatchObject({ stock: 9 });

    await request(app)
      .delete(`/products/${id}`)
      .set(...bearer(token));
    expect((await request(app).get(`/products/${id}`)).status).toBe(404);
    expect(await total()).toBe(0);
  });
});

describe('limitele parametrilor de cautare', () => {
  it('refuza un offset urias (anti umplere de cache cu chei distincte)', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/products?offset=1000001')).status).toBe(400);
    expect((await request(app).get('/products?offset=1000000')).status).toBe(200);
  });
});
