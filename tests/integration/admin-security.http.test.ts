import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { productResponseSchema } from '../../src/modules/catalog/adapters/http/catalog.schemas';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { uuid } from '../helpers/ids';

/**
 * Securitatea rutelor de administrare ale catalogului, cap-coada (middleware HTTP + AuthorizationProxy):
 * fara token -> 401, CUSTOMER -> 403, ADMIN -> 2xx.
 */
describe('rutele de administrare ale catalogului', () => {
  let ctx: TestApp;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    ctx = buildTestApp();
    adminToken = await ctx.adminToken();
    customerToken = await ctx.customerToken();
  });

  const validProduct = { name: 'Mouse', price: { amount: 5000, currency: 'RON' }, stock: 3 };
  const adminRoutes: [string, string, object][] = [
    ['post', '/products', validProduct],
    ['patch', `/products/${uuid(1)}`, { stock: 1 }],
    ['delete', `/products/${uuid(1)}`, {}],
    ['post', '/categories', { name: 'Categorie' }],
    ['patch', `/categories/${uuid(1)}`, { name: 'Alta' }],
    ['delete', `/categories/${uuid(1)}`, {}],
    ['post', '/bundles', { name: 'Set', items: [{ productId: uuid(1), quantity: 1 }] }],
    ['patch', `/bundles/${uuid(1)}`, { name: 'Alt set' }],
    ['delete', `/bundles/${uuid(1)}`, {}],
  ];

  it.each(adminRoutes)('%s %s fara token: 401', async (method, url, body) => {
    const response = await request(ctx.app)[method as 'post'](url).send(body);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it.each(adminRoutes)('%s %s cu CUSTOMER: 403', async (method, url, body) => {
    const response = await request(ctx.app)
      [method as 'post'](url)
      .set(...bearer(customerToken))
      .send(body);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it.each(adminRoutes)('%s %s cu token invalid: 401', async (method, url, body) => {
    const response = await request(ctx.app)
      [method as 'post'](url)
      .set(...bearer('token.invalid.aici'))
      .send(body);
    expect(response.status).toBe(401);
  });

  it('403 inainte de validare: un CUSTOMER nu afla nimic despre schema din raspunsuri de eroare', async () => {
    const response = await request(ctx.app)
      .post('/products')
      .set(...bearer(customerToken))
      .send({ nume: 'gresit' });
    expect(response.status).toBe(403);
  });

  it('o respingere nu produce efecte: nimic nu s-a creat', async () => {
    await request(ctx.app).post('/products').send(validProduct);
    await request(ctx.app)
      .post('/products')
      .set(...bearer(customerToken))
      .send(validProduct);
    const list = await request(ctx.app).get('/products');
    expect((list.body as { total: number }).total).toBe(0);
  });

  it('ADMIN poate crea, modifica si sterge', async () => {
    const created = await request(ctx.app)
      .post('/products')
      .set(...bearer(adminToken))
      .send(validProduct);
    expect(created.status).toBe(201);
    const { id } = productResponseSchema.parse(created.body);

    const updated = await request(ctx.app)
      .patch(`/products/${id}`)
      .set(...bearer(adminToken))
      .send({ stock: 10 });
    expect(updated.status).toBe(200);

    const deleted = await request(ctx.app)
      .delete(`/products/${id}`)
      .set(...bearer(adminToken));
    expect(deleted.status).toBe(204);
  });

  it('citirea catalogului ramane publica (fara token)', async () => {
    expect((await request(ctx.app).get('/products')).status).toBe(200);
    expect((await request(ctx.app).get('/categories')).status).toBe(200);
    expect((await request(ctx.app).get('/bundles')).status).toBe(200);
  });

  it('un token invalid pe o ruta publica da 401 (nu e ignorat in tacere)', async () => {
    const response = await request(ctx.app)
      .get('/products')
      .set(...bearer('token.invalid.aici'));
    expect(response.status).toBe(401);
  });
});
