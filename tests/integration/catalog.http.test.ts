import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '../../src/composition-root';
import { createApp } from '../../src/infrastructure/http/app';
import { openApiDocument } from '../../src/infrastructure/http/openapi';
import { createCatalogRouter } from '../../src/modules/catalog/adapters/http/catalog.routes';
import {
  bundleResponseSchema,
  categoryResponseSchema,
  productPageResponseSchema,
  productResponseSchema,
} from '../../src/modules/catalog/adapters/http/catalog.schemas';
import { CatalogAdminUseCases } from '../../src/modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from '../../src/modules/catalog/application/CatalogQueryService';
import { RandomUuidGenerator } from '../../src/shared';
import { silentLogger } from '../helpers/silent-logger';
import { uuid } from '../helpers/ids';

/** Garda de test: lasa sa treaca doar cererile cu antetul `x-test-admin: 1` (autentificarea reala e in modulul identity). */
function testGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.header('x-test-admin') === '1') {
    next();
    return;
  }
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Autentificare necesara' } });
}

function buildApp() {
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
      createCatalogRouter({ queries, admin: { guards: [testGuard], serviceFor: () => admin } }),
    ],
  });
}

type App = ReturnType<typeof buildApp>;
const asAdmin = (app: App) => ({
  post: (url: string) => request(app).post(url).set('x-test-admin', '1'),
  patch: (url: string) => request(app).patch(url).set('x-test-admin', '1'),
  delete: (url: string) => request(app).delete(url).set('x-test-admin', '1'),
});

describe('Catalog HTTP: citire publica', () => {
  let app: App;
  let admin: ReturnType<typeof asAdmin>;

  beforeEach(() => {
    app = buildApp();
    admin = asAdmin(app);
  });

  async function createProduct(body: Record<string, unknown>): Promise<{ id: string }> {
    const response = await admin.post('/products').send(body);
    expect(response.status).toBe(201);
    return response.body as { id: string };
  }

  it('listeaza gol cand nu exista produse', async () => {
    const response = await request(app).get('/products');
    expect(response.status).toBe(200);
    expect(productPageResponseSchema.parse(response.body)).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('cauta, filtreaza pe categorie (cu subcategorii) si pagineaza', async () => {
    const electronics = (await admin.post('/categories').send({ name: 'Electronice' })).body as {
      id: string;
    };
    const laptops = (
      await admin.post('/categories').send({ name: 'Laptopuri', parentId: electronics.id })
    ).body as { id: string };
    await createProduct({
      name: 'Laptop Pro',
      price: { amount: 500_000, currency: 'RON' },
      stock: 2,
      categoryId: laptops.id,
    });
    await createProduct({
      name: 'Casti',
      price: { amount: 20_000, currency: 'RON' },
      stock: 5,
      categoryId: electronics.id,
    });
    await createProduct({ name: 'Roman', price: { amount: 3000, currency: 'RON' }, stock: 1 });

    const search = await request(app).get('/products').query({ q: 'laptop' });
    expect(productPageResponseSchema.parse(search.body).items.map((p) => p.name)).toEqual([
      'Laptop Pro',
    ]);

    const byCategory = await request(app).get('/products').query({ categoryId: electronics.id });
    expect(productPageResponseSchema.parse(byCategory.body).items.map((p) => p.name)).toEqual([
      'Casti',
      'Laptop Pro',
    ]);

    const paged = await request(app).get('/products').query({ limit: 1, offset: 1 });
    expect(paged.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect((paged.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('intoarce detaliile unui produs si 404 pentru unul inexistent', async () => {
    const { id } = await createProduct({
      name: 'Mouse',
      description: 'Optic',
      price: { amount: 5000, currency: 'EUR' },
      stock: 3,
    });
    const found = await request(app).get(`/products/${id}`);
    expect(found.status).toBe(200);
    expect(productResponseSchema.parse(found.body)).toMatchObject({
      name: 'Mouse',
      price: { amount: 5000, currency: 'EUR' },
      stock: 3,
      categoryId: null,
    });

    const missing = await request(app).get(`/products/${uuid(9)}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it.each([
    ['limit zero', '/products?limit=0'],
    ['limit peste maxim', '/products?limit=101'],
    ['offset negativ', '/products?offset=-1'],
    ['limit nenumeric', '/products?limit=abc'],
    ['categoryId invalid', '/products?categoryId=nu-e-uuid'],
    ['id de produs invalid', '/products/nu-e-uuid'],
  ])('raspunde 400 la %s', async (_label, url) => {
    const response = await request(app).get(url);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('raspunde 404 la filtrarea dupa o categorie inexistenta', async () => {
    const response = await request(app)
      .get('/products')
      .query({ categoryId: uuid(9) });
    expect(response.status).toBe(404);
  });

  it('expune arborele de categorii', async () => {
    const root = (await admin.post('/categories').send({ name: 'Electronice' })).body as {
      id: string;
    };
    await admin.post('/categories').send({ name: 'Laptopuri', parentId: root.id });
    const response = await request(app).get('/categories');
    expect(response.status).toBe(200);
    const body = response.body as { items: { name: string; children: { name: string }[] }[] };
    expect(body.items.map((c) => c.name)).toEqual(['Electronice']);
    expect(body.items[0]?.children.map((c) => c.name)).toEqual(['Laptopuri']);
  });

  it('expune pachetele cu pret calculat si stoc disponibil', async () => {
    const mouse = await createProduct({
      name: 'Mouse',
      price: { amount: 5000, currency: 'RON' },
      stock: 10,
    });
    const created = await admin.post('/bundles').send({
      name: 'Set',
      discountPercent: 10,
      items: [{ productId: mouse.id, quantity: 2 }],
    });
    expect(created.status).toBe(201);
    const bundle = bundleResponseSchema.parse(created.body);
    expect(bundle.price).toEqual({ amount: 9000, currency: 'RON' });
    expect(bundle.availableStock).toBe(5);

    const list = await request(app).get('/bundles');
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    const one = await request(app).get(`/bundles/${bundle.id}`);
    expect(bundleResponseSchema.parse(one.body).items[0]).toMatchObject({
      productId: mouse.id,
      name: 'Mouse',
      quantity: 2,
    });
    expect((await request(app).get(`/bundles/${uuid(9)}`)).status).toBe(404);
  });
});

describe('Catalog HTTP: administrare', () => {
  let app: App;
  let admin: ReturnType<typeof asAdmin>;

  beforeEach(() => {
    app = buildApp();
    admin = asAdmin(app);
  });

  const validProduct = { name: 'Mouse', price: { amount: 5000, currency: 'RON' }, stock: 3 };

  it.each([
    ['POST', '/products'],
    ['PATCH', `/products/${uuid(1)}`],
    ['DELETE', `/products/${uuid(1)}`],
    ['POST', '/categories'],
    ['PATCH', `/categories/${uuid(1)}`],
    ['DELETE', `/categories/${uuid(1)}`],
    ['POST', '/bundles'],
    ['PATCH', `/bundles/${uuid(1)}`],
    ['DELETE', `/bundles/${uuid(1)}`],
  ])('%s %s trece prin garzile de administrare (401 fara ele)', async (method, url) => {
    const response = await request(app)[method.toLowerCase() as 'post'](url).send({});
    expect(response.status).toBe(401);
  });

  it('fara garzi furnizate, rutele de administrare nu exista deloc (securizat implicit)', async () => {
    const repositories = createInMemoryRepositories();
    const readOnly = createApp({
      logger: silentLogger,
      checkDatabase: () => Promise.resolve(),
      routers: [
        createCatalogRouter({
          queries: new CatalogQueryService(
            repositories.products,
            repositories.categories,
            repositories.bundles,
          ),
        }),
      ],
    });
    expect((await request(readOnly).post('/products').send(validProduct)).status).toBe(404);
    expect((await request(readOnly).get('/products')).status).toBe(200);
  });

  it('parcurge ciclul complet pe un produs: creare, modificare (stoc), stergere', async () => {
    const created = await admin.post('/products').send(validProduct);
    expect(created.status).toBe(201);
    const { id } = productResponseSchema.parse(created.body);

    const updated = await admin.patch(`/products/${id}`).send({ stock: 42, name: 'Mouse Pro' });
    expect(updated.status).toBe(200);
    expect(productResponseSchema.parse(updated.body)).toMatchObject({
      stock: 42,
      name: 'Mouse Pro',
    });

    expect((await admin.delete(`/products/${id}`)).status).toBe(204);
    expect((await request(app).get(`/products/${id}`)).status).toBe(404);
    expect((await admin.delete(`/products/${id}`)).status).toBe(404);
  });

  it.each([
    ['nume lipsa', { price: { amount: 1, currency: 'RON' }, stock: 1 }],
    ['pret fractionar', { name: 'X', price: { amount: 1.5, currency: 'RON' }, stock: 1 }],
    ['pret negativ', { name: 'X', price: { amount: -1, currency: 'RON' }, stock: 1 }],
    ['moneda necunoscuta', { name: 'X', price: { amount: 1, currency: 'GBP' }, stock: 1 }],
    ['stoc negativ', { name: 'X', price: { amount: 1, currency: 'RON' }, stock: -1 }],
    ['camp necunoscut', { ...validProduct, isAdmin: true }],
    ['categoryId invalid', { ...validProduct, categoryId: 'abc' }],
  ])('refuza la creare: %s (400)', async (_label, body) => {
    const response = await admin.post('/products').send(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('refuza o modificare goala (400) si un produs inexistent (404)', async () => {
    const { id } = (await admin.post('/products').send(validProduct)).body as { id: string };
    expect((await admin.patch(`/products/${id}`).send({})).status).toBe(400);
    expect((await admin.patch(`/products/${uuid(9)}`).send({ stock: 1 })).status).toBe(404);
  });

  it('refuza un produs intr-o categorie inexistenta (404)', async () => {
    const response = await admin.post('/products').send({ ...validProduct, categoryId: uuid(9) });
    expect(response.status).toBe(404);
  });

  it('gestioneaza categoriile: creare, redenumire, mutare, conflicte (409), stergere', async () => {
    const a = categoryResponseSchema.parse(
      (await admin.post('/categories').send({ name: 'A' })).body,
    );
    const b = categoryResponseSchema.parse(
      (await admin.post('/categories').send({ name: 'B', parentId: a.id })).body,
    );

    const duplicate = await admin.post('/categories').send({ name: 'a' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'CATEGORY_NAME_TAKEN' } });

    const cycle = await admin.patch(`/categories/${a.id}`).send({ parentId: b.id });
    expect(cycle.status).toBe(409);
    expect(cycle.body).toMatchObject({ error: { code: 'CATEGORY_CYCLE' } });

    const renamed = await admin.patch(`/categories/${b.id}`).send({ name: 'B2', parentId: null });
    expect(categoryResponseSchema.parse(renamed.body)).toMatchObject({
      name: 'B2',
      parentId: null,
    });

    expect((await admin.delete(`/categories/${b.id}`)).status).toBe(204);
    expect((await admin.delete(`/categories/${b.id}`)).status).toBe(404);
  });

  it('refuza stergerea unei categorii cu produse si a unui produs din pachet (409)', async () => {
    const category = (await admin.post('/categories').send({ name: 'C' })).body as { id: string };
    const { id: productId } = (
      await admin.post('/products').send({ ...validProduct, categoryId: category.id })
    ).body as { id: string };
    expect((await admin.delete(`/categories/${category.id}`)).status).toBe(409);

    await admin.post('/bundles').send({ name: 'Set', items: [{ productId, quantity: 1 }] });
    const blocked = await admin.delete(`/products/${productId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: { code: 'PRODUCT_IN_BUNDLE' } });
  });

  it('valideaza pachetele: componente duplicate (400), goale (400), monede diferite (422)', async () => {
    const ron = (await admin.post('/products').send(validProduct)).body as { id: string };
    const eur = (
      await admin
        .post('/products')
        .send({ ...validProduct, name: 'Euro', price: { amount: 100, currency: 'EUR' } })
    ).body as { id: string };

    const duplicate = await admin.post('/bundles').send({
      name: 'X',
      items: [
        { productId: ron.id, quantity: 1 },
        { productId: ron.id, quantity: 2 },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect((await admin.post('/bundles').send({ name: 'X', items: [] })).status).toBe(400);

    const mixed = await admin.post('/bundles').send({
      name: 'X',
      items: [
        { productId: ron.id, quantity: 1 },
        { productId: eur.id, quantity: 1 },
      ],
    });
    expect(mixed.status).toBe(422);
    expect(mixed.body).toMatchObject({ error: { code: 'MONEY_CURRENCY_MISMATCH' } });
  });

  it('modifica si sterge un pachet', async () => {
    const p = (await admin.post('/products').send(validProduct)).body as { id: string };
    const { id } = (
      await admin.post('/bundles').send({ name: 'Set', items: [{ productId: p.id, quantity: 1 }] })
    ).body as { id: string };
    const updated = await admin
      .patch(`/bundles/${id}`)
      .send({ name: 'Set nou', discountPercent: 50 });
    expect(bundleResponseSchema.parse(updated.body)).toMatchObject({
      name: 'Set nou',
      price: { amount: 2500 },
    });
    expect((await admin.delete(`/bundles/${id}`)).status).toBe(204);
    expect((await admin.patch(`/bundles/${id}`).send({ name: 'x' })).status).toBe(404);
  });
});

describe('Documentatia OpenAPI a catalogului', () => {
  const doc = openApiDocument as {
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  };

  it('documenteaza toate rutele implementate', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/products',
        '/products/{id}',
        '/categories',
        '/categories/{id}',
        '/bundles',
        '/bundles/{id}',
      ]),
    );
    expect(Object.keys(doc.paths['/products'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(doc.paths['/products/{id}'] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'patch',
    ]);
  });

  it('operatiile de administrare cer autentificare Bearer, cele de citire nu', () => {
    const operation = (path: string, method: string) =>
      (doc.paths[path] as Record<string, { security?: unknown }>)[method];
    expect(operation('/products', 'post')?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation('/products', 'get')?.security).toBeUndefined();
  });

  it('toate referintele $ref din document duc la scheme definite', () => {
    const refs = [
      ...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ].map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const name of refs) {
      expect(doc.components.schemas, `schema lipsa: ${String(name)}`).toHaveProperty(String(name));
    }
  });
});
