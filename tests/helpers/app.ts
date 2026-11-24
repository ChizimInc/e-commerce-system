import type { Express } from 'express';
import request from 'supertest';
import {
  createApplication,
  createInMemoryRepositories,
  type OrderingSettings,
  type PaymentSettings,
  type ShippingSettings,
  type Repositories,
} from '../../src/composition-root';
import { BcryptPasswordHasher } from '../../src/modules/identity/adapters/security/BcryptPasswordHasher';
import { BootstrapAdmin } from '../../src/modules/identity/application/BootstrapAdmin';
import { RandomUuidGenerator, type Clock, type EventBus } from '../../src/shared';
import { silentLogger } from './silent-logger';

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
export const TEST_PASSWORD = 'parola-de-test-123';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-123456';
const ADMIN_EMAIL = 'admin@test.local';

export interface TestApp {
  app: Express;
  repositories: Repositories;
  /** Token de ADMIN (contul se creeaza direct in repository, ca la seed). */
  adminToken: () => Promise<string>;
  /** Inregistreaza un CUSTOMER (daca nu exista) si intoarce tokenul lui. */
  customerToken: (email?: string) => Promise<string>;
}

export interface TestAppOptions {
  /** Regulile comenzilor (pret, validare); implicit: fara reduceri/TVA si cu praguri largi. */
  ordering?: OrderingSettings;
  events?: EventBus;
  /** Furnizorii de plata si ceasul (implicit: mock-urile locale si ceasul real). */
  payments?: PaymentSettings;
  /** Tarifele de livrare si curierii (implicit: livrare gratuita si mock-urile locale). */
  shipping?: ShippingSettings;
  clock?: Clock;
}

/** Aplicatia reala, asamblata pe adaptoare in-memory (fara baza de date), cu bcrypt rapid. */
export function buildTestApp(options: TestAppOptions = {}): TestApp {
  const repositories = createInMemoryRepositories();
  const app = createApplication({
    logger: silentLogger,
    repositories,
    security: {
      jwtSecret: TEST_JWT_SECRET,
      jwtExpiresInSeconds: 3600,
      bcryptRounds: 4,
      authRateLimit: { windowMs: 60_000, max: 10_000 },
    },
    checkDatabase: () => Promise.resolve(),
    payments: { webhookSecret: TEST_WEBHOOK_SECRET },
    ...options,
  });

  const login = async (email: string): Promise<string> => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD });
    if (response.status !== 200) throw new Error(`login esuat pentru ${email}: ${response.status}`);
    return (response.body as { accessToken: string }).accessToken;
  };

  return {
    app,
    repositories,
    adminToken: async () => {
      await new BootstrapAdmin(
        repositories.users,
        new BcryptPasswordHasher(4),
        new RandomUuidGenerator(),
      ).execute(ADMIN_EMAIL, TEST_PASSWORD);
      return login(ADMIN_EMAIL);
    },
    customerToken: async (email = 'client@test.local') => {
      await request(app).post('/auth/register').send({ email, password: TEST_PASSWORD });
      return login(email);
    },
  };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
