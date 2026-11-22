import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { cartResponseSchema } from '../../src/modules/cart/adapters/http/cart.schemas';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { uuid } from '../helpers/ids';

describe('Cos (HTTP)', () => {
  let ctx: TestApp;
  let admin: string;
  let ana: string;
  let mouseId: string;
  let keyboardId: string;

  const asUser = (token: string) => ({
    get: (url: string) =>
      request(ctx.app)
        .get(url)
        .set(...bearer(token)),
    post: (url: string) =>
      request(ctx.app)
        .post(url)
        .set(...bearer(token)),
    patch: (url: string) =>
      request(ctx.app)
        .patch(url)
        .set(...bearer(token)),
    delete: (url: string) =>
      request(ctx.app)
        .delete(url)
        .set(...bearer(token)),
  });

  const createProduct = async (body: object): Promise<string> => {
    const response = await asUser(admin).post('/products').send(body);
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };

  beforeEach(async () => {
    ctx = buildTestApp();
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    mouseId = await createProduct({
      name: 'Mouse',
      price: { amount: 5000, currency: 'RON' },
      stock: 5,
    });
    keyboardId = await createProduct({
      name: 'Tastatura',
      price: { amount: 12_999, currency: 'RON' },
      stock: 2,
    });
  });

  it.each([
    ['get', '/cart'],
    ['post', '/cart/items'],
    ['patch', `/cart/items/${uuid(1)}`],
    ['delete', `/cart/items/${uuid(1)}`],
    ['delete', '/cart'],
  ])('%s %s fara token: 401', async (method, url) => {
    const response = await request(ctx.app)[method as 'get'](url);
    expect(response.status).toBe(401);
  });

  it('cosul unui utilizator nou e gol, cu total 0', async () => {
    const response = await asUser(ana).get('/cart');
    expect(response.status).toBe(200);
    expect(cartResponseSchema.parse(response.body)).toEqual({
      items: [],
      itemCount: 0,
      total: { amount: 0, currency: 'RON' },
    });
  });

  it('parcurge fluxul: adaugare, modificare cantitate, stergere, golire', async () => {
    const user = asUser(ana);

    let response = await user.post('/cart/items').send({ itemId: mouseId, quantity: 2 });
    expect(response.status).toBe(200);
    response = await user.post('/cart/items').send({ itemId: keyboardId }); // cantitate implicita 1
    let cart = cartResponseSchema.parse(response.body);
    expect(cart.items.map((i) => [i.name, i.quantity])).toEqual([
      ['Mouse', 2],
      ['Tastatura', 1],
    ]);
    expect(cart.total).toEqual({ amount: 2 * 5000 + 12_999, currency: 'RON' });
    expect(cart.itemCount).toBe(3);

    response = await user.patch(`/cart/items/${mouseId}`).send({ quantity: 5 });
    cart = cartResponseSchema.parse(response.body);
    expect(cart.total.amount).toBe(5 * 5000 + 12_999);

    response = await user.delete(`/cart/items/${keyboardId}`);
    cart = cartResponseSchema.parse(response.body);
    expect(cart.items.map((i) => i.name)).toEqual(['Mouse']);
    expect(cart.total.amount).toBe(25_000);

    // cosul e persistent intre cereri
    expect(cartResponseSchema.parse((await user.get('/cart')).body).itemCount).toBe(5);

    response = await user.delete('/cart');
    expect(cartResponseSchema.parse(response.body)).toMatchObject({
      items: [],
      total: { amount: 0 },
    });
  });

  it('adaugarea aceluiasi produs aduna cantitatea', async () => {
    const user = asUser(ana);
    await user.post('/cart/items').send({ itemId: mouseId, quantity: 2 });
    const response = await user.post('/cart/items').send({ itemId: mouseId, quantity: 1 });
    expect(cartResponseSchema.parse(response.body).items).toHaveLength(1);
    expect(cartResponseSchema.parse(response.body).items[0]?.quantity).toBe(3);
  });

  it('valideaza stocul: 409 INSUFFICIENT_STOCK si cosul ramane neschimbat', async () => {
    const user = asUser(ana);
    await user.post('/cart/items').send({ itemId: keyboardId, quantity: 2 });
    const tooMany = await user.post('/cart/items').send({ itemId: keyboardId, quantity: 1 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });

    const update = await user.patch(`/cart/items/${keyboardId}`).send({ quantity: 3 });
    expect(update.status).toBe(409);
    expect(cartResponseSchema.parse((await user.get('/cart')).body).items[0]?.quantity).toBe(2);
  });

  it('adauga un pachet in cos, cu pretul calculat din componente', async () => {
    const bundle = await asUser(admin)
      .post('/bundles')
      .send({
        name: 'Set',
        discountPercent: 10,
        items: [
          { productId: mouseId, quantity: 1 },
          { productId: keyboardId, quantity: 1 },
        ],
      });
    const bundleId = (bundle.body as { id: string }).id;
    const response = await asUser(ana).post('/cart/items').send({ itemId: bundleId, quantity: 1 });
    expect(response.status).toBe(200);
    expect(cartResponseSchema.parse(response.body).total.amount).toBe(16_199);
  });

  it('cosurile utilizatorilor sunt izolate', async () => {
    const bob = await ctx.customerToken('bob@test.local');
    await asUser(ana).post('/cart/items').send({ itemId: mouseId, quantity: 3 });
    expect(cartResponseSchema.parse((await asUser(bob).get('/cart')).body).items).toEqual([]);
    // Bob nu poate sterge din cosul Anei: nu are acel articol in cosul lui
    expect((await asUser(bob).delete(`/cart/items/${mouseId}`)).status).toBe(404);
    expect(cartResponseSchema.parse((await asUser(ana).get('/cart')).body).itemCount).toBe(3);
  });

  it('un ADMIN are propriul cos, ca orice utilizator', async () => {
    await asUser(admin).post('/cart/items').send({ itemId: mouseId, quantity: 1 });
    expect(cartResponseSchema.parse((await asUser(admin).get('/cart')).body).itemCount).toBe(1);
    expect(cartResponseSchema.parse((await asUser(ana).get('/cart')).body).itemCount).toBe(0);
  });

  it('404 pentru produs inexistent, articol lipsa din cos', async () => {
    const user = asUser(ana);
    expect((await user.post('/cart/items').send({ itemId: uuid(404) })).status).toBe(404);
    expect((await user.patch(`/cart/items/${mouseId}`).send({ quantity: 1 })).status).toBe(404);
    expect((await user.delete(`/cart/items/${mouseId}`)).status).toBe(404);
  });

  it('un produs sters din catalog dispare din cos fara sa-l strice', async () => {
    const user = asUser(ana);
    await user.post('/cart/items').send({ itemId: mouseId, quantity: 1 });
    await user.post('/cart/items').send({ itemId: keyboardId, quantity: 1 });
    await asUser(admin).delete(`/products/${keyboardId}`);
    const cart = cartResponseSchema.parse((await user.get('/cart')).body);
    expect(cart.items.map((i) => i.name)).toEqual(['Mouse']);
    expect(cart.total.amount).toBe(5000);
  });

  it('reflecta stocul scazut dupa adaugare (inStock = false)', async () => {
    const user = asUser(ana);
    await user.post('/cart/items').send({ itemId: mouseId, quantity: 4 });
    await asUser(admin).patch(`/products/${mouseId}`).send({ stock: 1 });
    const item = cartResponseSchema.parse((await user.get('/cart')).body).items[0];
    expect(item).toMatchObject({ quantity: 4, availableStock: 1, inStock: false });
  });

  it.each([
    ['cantitate zero', { itemId: uuid(1), quantity: 0 }],
    ['cantitate negativa', { itemId: uuid(1), quantity: -2 }],
    ['cantitate fractionara', { itemId: uuid(1), quantity: 1.5 }],
    ['cantitate peste maxim', { itemId: uuid(1), quantity: 101 }],
    ['cantitate text', { itemId: uuid(1), quantity: '2' }],
    ['itemId invalid', { itemId: 'abc', quantity: 1 }],
    ['itemId lipsa', { quantity: 1 }],
    ['camp necunoscut', { itemId: uuid(1), quantity: 1, price: 1 }],
  ])('raspunde 400 la %s', async (_label, body) => {
    const response = await asUser(ana).post('/cart/items').send(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('PATCH cere cantitate valida (400); stergerea se face cu DELETE, nu cu 0', async () => {
    await asUser(ana).post('/cart/items').send({ itemId: mouseId });
    for (const quantity of [0, -1, 1.5, 'x']) {
      const response = await asUser(ana).patch(`/cart/items/${mouseId}`).send({ quantity });
      expect(response.status).toBe(400);
    }
    expect((await asUser(ana).patch('/cart/items/nu-e-uuid').send({ quantity: 1 })).status).toBe(
      400,
    );
  });

  it('nu accepta pretul de la client: totalul vine doar din catalog', async () => {
    const response = await asUser(ana)
      .post('/cart/items')
      .send({ itemId: mouseId, quantity: 1, price: 1 });
    expect(response.status).toBe(400);
  });
});
