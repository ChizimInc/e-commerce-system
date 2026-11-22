import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../../src/infrastructure/http/openapi';
import { bearer, buildTestApp, TEST_PASSWORD } from '../helpers/app';

/** Scenariul complet al celor doua iteratii, ca un utilizator real: admin -> catalog -> client -> cos. */
describe('flux complet: administrare catalog -> cumparator -> cos', () => {
  it('admin creeaza catalogul, clientul se inregistreaza, cauta si isi completeaza cosul', async () => {
    const { app, adminToken } = buildTestApp();
    const admin = await adminToken();

    const category = await request(app)
      .post('/categories')
      .set(...bearer(admin))
      .send({ name: 'Periferice' });
    expect(category.status).toBe(201);
    const categoryId = (category.body as { id: string }).id;

    const product = await request(app)
      .post('/products')
      .set(...bearer(admin))
      .send({
        name: 'Mouse wireless',
        description: 'Optic, 1600 DPI',
        price: { amount: 7999, currency: 'RON' },
        stock: 10,
        categoryId,
      });
    expect(product.status).toBe(201);
    const productId = (product.body as { id: string }).id;

    // clientul se inregistreaza si se autentifica
    expect(
      (
        await request(app)
          .post('/auth/register')
          .send({ email: 'client@shop.ro', password: TEST_PASSWORD })
      ).status,
    ).toBe(201);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'client@shop.ro', password: TEST_PASSWORD });
    const token = (login.body as { accessToken: string }).accessToken;

    // clientul nu poate modifica catalogul
    const forbidden = await request(app)
      .patch(`/products/${productId}`)
      .set(...bearer(token))
      .send({ stock: 999 });
    expect(forbidden.status).toBe(403);

    // cauta produsul, apoi il pune in cos
    const found = await request(app).get('/products').query({ q: 'wireless', categoryId });
    expect((found.body as { items: { id: string }[] }).items.map((p) => p.id)).toEqual([productId]);

    const cart = await request(app)
      .post('/cart/items')
      .set(...bearer(token))
      .send({ itemId: productId, quantity: 3 });
    expect(cart.status).toBe(200);
    expect(cart.body).toMatchObject({
      itemCount: 3,
      total: { amount: 3 * 7999, currency: 'RON' },
    });

    // stocul nu a fost modificat de cos (rezervarea apartine comenzii, Iteratia 3)
    const after = await request(app).get(`/products/${productId}`);
    expect((after.body as { stock: number }).stock).toBe(10);
  });
});

describe('documentatia OpenAPI completa (Iteratiile 1-2)', () => {
  const doc = openApiDocument as {
    paths: Record<string, Record<string, { security?: unknown }>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };

  it('documenteaza autentificarea si cosul', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/auth/register', '/auth/login', '/auth/me', '/cart', '/cart/items']),
    );
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('rutele cosului si /auth/me cer Bearer; /auth/login si /auth/register nu', () => {
    expect(doc.paths['/cart']?.['get']?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/auth/me']?.['get']?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/auth/login']?.['post']?.security).toBeUndefined();
    expect(doc.paths['/auth/register']?.['post']?.security).toBeUndefined();
  });

  it('toate referintele $ref duc la scheme definite', () => {
    const refs = [
      ...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ].map((match) => String(match[1]));
    for (const name of refs) expect(doc.components.schemas).toHaveProperty(name);
  });
});
