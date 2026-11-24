import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { productResponseSchema } from '../../src/modules/catalog/adapters/http/catalog.schemas';
import {
  orderPageResponseSchema,
  orderResponseSchema,
} from '../../src/modules/ordering/adapters/http/orders.schemas';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { ADDRESS_PROPS } from '../helpers/order-fixtures';
import { uuid } from '../helpers/ids';

const ORDER_BODY = { address: ADDRESS_PROPS, deliveryMethod: 'EXPRESS', paymentMethod: 'PAYPAL' };

describe('Comenzi (HTTP)', () => {
  let ctx: TestApp;
  let admin: string;
  let ana: string;
  let bob: string;
  let mouseId: string;
  let keyboardId: string;

  const as = (token: string) => ({
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
  });

  const createProduct = async (body: object): Promise<string> => {
    const response = await as(admin).post('/products').send(body);
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };

  const stockOf = async (id: string): Promise<number> =>
    productResponseSchema.parse((await request(ctx.app).get(`/products/${id}`)).body).stock;

  const addToCart = async (token: string, itemId: string, quantity: number): Promise<void> => {
    const response = await as(token).post('/cart/items').send({ itemId, quantity });
    expect(response.status).toBe(200);
  };

  const placeOrder = async (token: string, body: object = ORDER_BODY) =>
    as(token).post('/orders').send(body);

  beforeEach(async () => {
    ctx = buildTestApp();
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    bob = await ctx.customerToken('bob@test.local');
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
    ['get', '/orders'],
    ['post', '/orders'],
    ['get', `/orders/${uuid(1)}`],
    ['patch', `/orders/${uuid(1)}/status`],
  ])('%s %s fara token: 401', async (method, url) => {
    const response = await request(ctx.app)[method as 'get'](url);
    expect(response.status).toBe(401);
  });

  describe('POST /orders', () => {
    it('creeaza comanda din cos: 201, preturi copiate, stoc scazut, cos golit', async () => {
      await addToCart(ana, mouseId, 2);
      await addToCart(ana, keyboardId, 1);

      const response = await placeOrder(ana);

      expect(response.status).toBe(201);
      const order = orderResponseSchema.parse(response.body);
      expect(order.status).toBe('NEW');
      expect(order.paidAt).toBeNull();
      expect(order.deliveryMethod).toBe('EXPRESS');
      expect(order.paymentMethod).toBe('PAYPAL');
      expect(order.address).toEqual(ADDRESS_PROPS);
      expect(
        order.items.map((i) => [i.name, i.quantity, i.unitPrice.amount, i.lineTotal.amount]),
      ).toEqual([
        ['Mouse', 2, 5000, 10_000],
        ['Tastatura', 1, 12_999, 12_999],
      ]);
      expect(order.total).toEqual({ amount: 22_999, currency: 'RON' });

      expect(await stockOf(mouseId)).toBe(3);
      expect(await stockOf(keyboardId)).toBe(1);
      expect((await as(ana).get('/cart')).body).toMatchObject({ items: [], itemCount: 0 });
    });

    it('comanda pentru un pachet scade stocul componentelor', async () => {
      const bundle = await as(admin)
        .post('/bundles')
        .send({
          name: 'Set',
          discountPercent: 10,
          items: [
            { productId: mouseId, quantity: 2 },
            { productId: keyboardId, quantity: 1 },
          ],
        });
      await addToCart(ana, (bundle.body as { id: string }).id, 1);

      const response = await placeOrder(ana);

      expect(response.status).toBe(201);
      expect(orderResponseSchema.parse(response.body).total.amount).toBe(
        Math.round((2 * 5000 + 12_999) * 0.9),
      );
      expect(await stockOf(mouseId)).toBe(3);
      expect(await stockOf(keyboardId)).toBe(1);
    });

    it('pretul din comanda nu se schimba cand produsul se scumpeste', async () => {
      await addToCart(ana, mouseId, 1);
      const created = orderResponseSchema.parse((await placeOrder(ana)).body);
      await as(admin)
        .patch(`/products/${mouseId}`)
        .send({ price: { amount: 99_000, currency: 'RON' } });

      const reloaded = orderResponseSchema.parse((await as(ana).get(`/orders/${created.id}`)).body);
      expect(reloaded.total.amount).toBe(5000);
      expect(reloaded.items[0]?.unitPrice.amount).toBe(5000);
    });

    it('total peste limita INTEGER din baza de date: 422 INVALID_ORDER, nu 500; nimic nu se schimba', async () => {
      const pricey = await createProduct({
        name: 'Iaht',
        price: { amount: 1_000_000_000, currency: 'RON' },
        stock: 5,
      });
      await addToCart(ana, pricey, 3); // 3 x 10.000.000,00 RON = 3 miliarde de cenți > 2.147.483.647

      const response = await placeOrder(ana);

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_ORDER' } });
      expect(await stockOf(pricey)).toBe(5);
      expect((await as(ana).get('/cart')).body).toMatchObject({ itemCount: 3 });
    });

    it('cos gol: 422 INVALID_ORDER', async () => {
      const response = await placeOrder(ana);
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_ORDER' } });
    });

    it('stoc insuficient (scazut intre timp): 409 INSUFFICIENT_STOCK, nimic nu se schimba', async () => {
      await addToCart(ana, keyboardId, 2);
      await as(admin).patch(`/products/${keyboardId}`).send({ stock: 1 });

      const response = await placeOrder(ana);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });
      expect(await stockOf(keyboardId)).toBe(1);
      expect((await as(ana).get('/cart')).body).toMatchObject({ itemCount: 2 });
      expect(orderPageResponseSchema.parse((await as(ana).get('/orders')).body).total).toBe(0);
    });

    it('doi clienti pentru ultima bucata: unul primeste 201, celalalt 409', async () => {
      await as(admin).patch(`/products/${keyboardId}`).send({ stock: 1 });
      await addToCart(ana, keyboardId, 1);
      await addToCart(bob, keyboardId, 1);

      const [first, second] = await Promise.all([placeOrder(ana), placeOrder(bob)]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await stockOf(keyboardId)).toBe(0);
    });

    it.each([
      ['fara adresa', { deliveryMethod: 'STANDARD', paymentMethod: 'CARD' }],
      ['fara metoda de plata', { address: ADDRESS_PROPS, deliveryMethod: 'STANDARD' }],
      ['metoda de livrare necunoscuta', { ...ORDER_BODY, deliveryMethod: 'TELEPORT' }],
      ['camp in plus', { ...ORDER_BODY, total: 1 }],
      ['tara invalida', { ...ORDER_BODY, address: { ...ADDRESS_PROPS, country: 'ROU' } }],
      ['oras gol', { ...ORDER_BODY, address: { ...ADDRESS_PROPS, city: '  ' } }],
    ])('corp invalid (%s): 400 VALIDATION_ERROR', async (_name, body) => {
      await addToCart(ana, mouseId, 1);
      const response = await placeOrder(ana, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(await stockOf(mouseId)).toBe(5); // cererea invalida nu atinge stocul
    });
  });

  describe('GET /orders si GET /orders/:id (clientul vede doar comenzile lui)', () => {
    let anaOrderId: string;
    let bobOrderId: string;

    beforeEach(async () => {
      await addToCart(ana, mouseId, 1);
      anaOrderId = orderResponseSchema.parse((await placeOrder(ana)).body).id;
      await addToCart(bob, mouseId, 2);
      bobOrderId = orderResponseSchema.parse((await placeOrder(bob)).body).id;
    });

    it('istoricul contine doar comenzile apelantului, cu paginare', async () => {
      const page = orderPageResponseSchema.parse((await as(ana).get('/orders')).body);
      expect(page.items.map((o) => o.id)).toEqual([anaOrderId]);
      expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });

      await addToCart(ana, mouseId, 1);
      await placeOrder(ana);
      const second = orderPageResponseSchema.parse(
        (await as(ana).get('/orders?limit=1&offset=1')).body,
      );
      expect(second).toMatchObject({ total: 2, limit: 1, offset: 1 });
      expect(second.items).toHaveLength(1);
    });

    it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=abc'])(
      'parametru invalid %s: 400',
      async (query) => {
        expect((await as(ana).get(`/orders?${query}`)).status).toBe(400);
      },
    );

    it('clientul isi vede comanda', async () => {
      const response = await as(ana).get(`/orders/${anaOrderId}`);
      expect(response.status).toBe(200);
      expect(orderResponseSchema.parse(response.body).id).toBe(anaOrderId);
    });

    it('comanda altui client: 404 (nu 403), la fel ca una inexistenta', async () => {
      const other = await as(ana).get(`/orders/${bobOrderId}`);
      const missing = await as(ana).get(`/orders/${uuid(77)}`);
      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('id invalid: 400', async () => {
      expect((await as(ana).get('/orders/nu-e-uuid')).status).toBe(400);
    });

    it('ADMIN vede comanda oricarui client', async () => {
      const response = await as(admin).get(`/orders/${bobOrderId}`);
      expect(response.status).toBe(200);
      expect(orderResponseSchema.parse(response.body).customerId).not.toBe(
        orderResponseSchema.parse((await as(ana).get(`/orders/${anaOrderId}`)).body).customerId,
      );
    });
  });

  describe('PATCH /orders/:id/status (ADMIN)', () => {
    let orderId: string;
    const setStatus = (token: string, status: string, id = orderId) =>
      as(token).patch(`/orders/${id}/status`).send({ status });

    beforeEach(async () => {
      await addToCart(ana, mouseId, 1);
      orderId = orderResponseSchema.parse((await placeOrder(ana)).body).id;
    });

    it('CUSTOMER primeste 403, chiar pe comanda lui; statusul ramane NEW', async () => {
      const response = await setStatus(ana, 'PAID');
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(orderResponseSchema.parse((await as(ana).get(`/orders/${orderId}`)).body).status).toBe(
        'NEW',
      );
    });

    it('parcurge ciclul de viata complet: NEW -> PAID -> SHIPPED -> DELIVERED', async () => {
      const paid = orderResponseSchema.parse((await setStatus(admin, 'PAID')).body);
      expect(paid.status).toBe('PAID');
      expect(paid.paidAt).not.toBeNull();
      expect(orderResponseSchema.parse((await setStatus(admin, 'SHIPPED')).body).status).toBe(
        'SHIPPED',
      );
      expect(orderResponseSchema.parse((await setStatus(admin, 'DELIVERED')).body).status).toBe(
        'DELIVERED',
      );
      // clientul vede statusul final
      expect(orderResponseSchema.parse((await as(ana).get(`/orders/${orderId}`)).body).status).toBe(
        'DELIVERED',
      );
    });

    it('anulare dupa plata, apoi rambursare', async () => {
      await setStatus(admin, 'PAID');
      expect(orderResponseSchema.parse((await setStatus(admin, 'CANCELLED')).body).status).toBe(
        'CANCELLED',
      );
      expect(orderResponseSchema.parse((await setStatus(admin, 'REFUNDED')).body).status).toBe(
        'REFUNDED',
      );
    });

    it.each([
      ['SHIPPED', 'NEW -> SHIPPED'],
      ['DELIVERED', 'NEW -> DELIVERED'],
      ['REFUNDED', 'NEW -> REFUNDED'],
      ['NEW', 'NEW -> NEW'],
    ])('tranzitie invalida catre %s: 422 INVALID_ORDER_TRANSITION', async (target, text) => {
      const response = await setStatus(admin, target);
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        error: {
          code: 'INVALID_ORDER_TRANSITION',
          message: expect.stringContaining(text) as string,
        },
      });
    });

    it('o comanda anulata inainte de plata nu se ramburseaza', async () => {
      await setStatus(admin, 'CANCELLED');
      const response = await setStatus(admin, 'REFUNDED');
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_ORDER_TRANSITION' } });
    });

    it('a doua plata e respinsa (NFR4)', async () => {
      await setStatus(admin, 'PAID');
      expect((await setStatus(admin, 'PAID')).status).toBe(422);
    });

    it('status necunoscut sau corp gol: 400', async () => {
      expect((await setStatus(admin, 'LOST')).status).toBe(400);
      expect((await as(admin).patch(`/orders/${orderId}/status`).send({})).status).toBe(400);
    });

    it('comanda inexistenta: 404', async () => {
      expect((await setStatus(admin, 'PAID', uuid(77))).status).toBe(404);
    });
  });
});
