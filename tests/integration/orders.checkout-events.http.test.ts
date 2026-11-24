import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '../../src/composition-root';
import { productResponseSchema } from '../../src/modules/catalog/adapters/http/catalog.schemas';
import { orderResponseSchema } from '../../src/modules/ordering/adapters/http/orders.schemas';
import {
  ORDER_EVENT_TYPES,
  type OrderEvent,
} from '../../src/modules/ordering/domain/events/OrderEvents';
import { InMemoryEventBus, type EventBus } from '../../src/shared';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { ADDRESS_PROPS } from '../helpers/order-fixtures';
import { silentLogger } from '../helpers/silent-logger';

const ORDER_BODY = { address: ADDRESS_PROPS, deliveryMethod: 'STANDARD', paymentMethod: 'CARD' };

/** Reguli de test: TVA 19%, reducere 5% de la 500.00 si 10% de la 1000.00; livrare doar in MD. */
const SETTINGS: OrderingSettings = {
  ...DEFAULT_ORDERING_SETTINGS,
  pricing: {
    vatPercent: 19,
    discountTiers: [
      { minSubtotalCents: 50_000, percent: 5 },
      { minSubtotalCents: 100_000, percent: 10 },
    ],
  },
  allowedCountries: ['MD'],
  maxOrderAmountCents: 2_000_000, // 20.000,00
  fraud: { maxOrdersPerWindow: 3, windowMs: 600_000, suspiciousAmountCents: 1_500_000 },
};

describe('Comenzi (HTTP): pret, validare si evenimente', () => {
  let ctx: TestApp;
  let events: InMemoryEventBus;
  let published: OrderEvent[];
  let admin: string;
  let ana: string;
  let keyboardId: string; // 100.00 RON, stoc 20
  let mouseId: string; // 25.50 RON, stoc 10

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

  const setup = async (settings: OrderingSettings = SETTINGS, bus?: EventBus) => {
    events = new InMemoryEventBus(silentLogger);
    published = [];
    for (const type of ORDER_EVENT_TYPES) {
      events.subscribe<OrderEvent>(type, (event) => {
        published.push(event);
      });
    }
    ctx = buildTestApp({ ordering: settings, events: bus ?? events });
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    keyboardId = await createProduct('Tastatura', 10_000, 20);
    mouseId = await createProduct('Mouse', 2_550, 10);
  };

  const createProduct = async (name: string, amount: number, stock: number): Promise<string> => {
    const response = await as(admin)
      .post('/products')
      .send({ name, price: { amount, currency: 'RON' }, stock });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };

  const stockOf = async (id: string): Promise<number> =>
    productResponseSchema.parse((await request(ctx.app).get(`/products/${id}`)).body).stock;

  const addToCart = async (itemId: string, quantity: number, token = ana): Promise<void> => {
    expect((await as(token).post('/cart/items').send({ itemId, quantity })).status).toBe(200);
  };

  const placeOrder = (body: object = ORDER_BODY, token = ana) =>
    as(token).post('/orders').send(body);

  const setStatus = (orderId: string, status: string) =>
    as(admin).patch(`/orders/${orderId}/status`).send({ status });

  beforeEach(async () => {
    await setup();
  });

  describe('pret: reducere + TVA (Decorator)', () => {
    it('comanda sub primul prag are doar TVA: subtotal, reducere 0, TVA, total', async () => {
      await addToCart(keyboardId, 2); // 200.00
      const response = await placeOrder();

      expect(response.status).toBe(201);
      const order = orderResponseSchema.parse(response.body);
      expect(order.subtotal).toEqual({ amount: 20_000, currency: 'RON' });
      expect(order.discount).toEqual({ amount: 0, currency: 'RON' });
      expect(order.vat).toEqual({ amount: 3_800, currency: 'RON' });
      expect(order.total).toEqual({ amount: 23_800, currency: 'RON' });
    });

    it('peste un prag: reducere pe subtotal, apoi TVA pe suma redusa; aceleasi valori la citire si in istoric', async () => {
      await addToCart(keyboardId, 10); // 1000.00 -> prag 10%
      await addToCart(mouseId, 2); // + 51.00 = 1051.00
      const created = orderResponseSchema.parse((await placeOrder()).body);

      // subtotal 105.100, reducere 10% = 10.510 (rotunjit), baza TVA 94.590, TVA 19% = 17.972,1 -> 17.972
      expect(created.subtotal.amount).toBe(105_100);
      expect(created.discount.amount).toBe(10_510);
      expect(created.vat.amount).toBe(17_972);
      expect(created.total.amount).toBe(105_100 - 10_510 + 17_972);

      const fetched = orderResponseSchema.parse((await as(ana).get(`/orders/${created.id}`)).body);
      expect(fetched).toEqual(created);
      const history = (await as(ana).get('/orders')).body as { items: unknown[] };
      expect(orderResponseSchema.parse(history.items[0])).toEqual(created);
    });

    it('un pachet intra in calcul cu pretul lui (care are deja reducerea pachetului)', async () => {
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
      await addToCart((bundle.body as { id: string }).id, 1);

      const order = orderResponseSchema.parse((await placeOrder()).body);

      const bundlePrice = Math.round((2 * 2_550 + 10_000) * 0.9); // 13.590
      expect(order.subtotal.amount).toBe(bundlePrice);
      expect(order.vat.amount).toBe(Math.round(bundlePrice * 0.19));
      expect(order.total.amount).toBe(bundlePrice + Math.round(bundlePrice * 0.19));
    });

    it('un total care cu TVA depaseste INTEGER-ul din baza de date: 422 INVALID_ORDER, nu 500', async () => {
      await setup({
        ...SETTINGS,
        maxOrderAmountCents: 2_147_483_647,
        fraud: { ...SETTINGS.fraud, suspiciousAmountCents: 2_147_483_647 },
        pricing: { vatPercent: 19, discountTiers: [] },
      });
      const yacht = await createProduct('Iaht', 1_000_000_000, 5);
      await addToCart(yacht, 2); // 2.000.000.000 incape, cu TVA (2.380.000.000) nu
      const response = await placeOrder();

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_ORDER' } });
      expect(await stockOf(yacht)).toBe(5);
    });
  });

  describe('lant de validare (Chain of Responsibility)', () => {
    const untouched = async (stock: number, id = keyboardId) => {
      expect(await stockOf(id)).toBe(stock);
      expect((await as(ana).get('/cart')).body).toMatchObject({
        itemCount: expect.any(Number) as number,
      });
      expect(((await as(ana).get('/orders')).body as { total: number }).total).toBe(0);
      expect(published).toEqual([]);
    };

    it('tara nelivrabila: 422 UNSUPPORTED_COUNTRY, fara comanda, stoc si cos neatinse', async () => {
      await addToCart(keyboardId, 1);
      const response = await placeOrder({
        ...ORDER_BODY,
        address: { ...ADDRESS_PROPS, country: 'US' },
      });

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'UNSUPPORTED_COUNTRY' } });
      await untouched(20);
      expect(((await as(ana).get('/cart')).body as { itemCount: number }).itemCount).toBe(1);
    });

    it('stoc insuficient: 409 INSUFFICIENT_STOCK', async () => {
      await addToCart(mouseId, 4);
      await as(admin).patch(`/products/${mouseId}`).send({ stock: 1 });

      const response = await placeOrder();

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });
      expect(await stockOf(mouseId)).toBe(1);
      expect(published).toEqual([]);
    });

    it('suma peste limita: 422 AMOUNT_LIMIT_EXCEEDED', async () => {
      const big = await createProduct('Server', 1_000_000, 5); // 10.000,00 / buc
      await addToCart(big, 3); // 30.000,00 + TVA > limita de 20.000,00
      const response = await placeOrder();

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'AMOUNT_LIMIT_EXCEEDED' } });
      expect(await stockOf(big)).toBe(5);
    });

    it('suma neobisnuita (sub limita, peste pragul anti-frauda): 422 ORDER_FLAGGED', async () => {
      const mid = await createProduct('Statie', 1_600_000, 5); // 16.000,00 -10% + TVA = 17.136,00 > 15.000,00, < 20.000,00
      await addToCart(mid, 1);
      const response = await placeOrder();

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'ORDER_FLAGGED' } });
      expect(await stockOf(mid)).toBe(5);
    });

    it('prea multe comenzi intr-un interval scurt: 429 ORDER_RATE_LIMITED, fara sa scada stocul', async () => {
      for (let i = 0; i < 3; i++) {
        await addToCart(mouseId, 1);
        expect((await placeOrder()).status).toBe(201);
      }
      await addToCart(mouseId, 1);

      const response = await placeOrder();

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ error: { code: 'ORDER_RATE_LIMITED' } });
      expect(await stockOf(mouseId)).toBe(7); // doar cele 3 comenzi acceptate
      expect(published.filter((e) => e.type === 'OrderPlaced')).toHaveLength(3);
    });
  });

  describe('evenimente (Observer) si repunerea stocului', () => {
    it('ciclul de viata emite OrderPlaced, OrderPaid, OrderShipped, OrderDelivered, in ordine', async () => {
      await addToCart(keyboardId, 1);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      for (const status of ['PAID', 'SHIPPED', 'DELIVERED']) {
        expect((await setStatus(order.id, status)).status).toBe(200);
      }

      expect(published.map((e) => e.type)).toEqual([
        'OrderPlaced',
        'OrderPaid',
        'OrderShipped',
        'OrderDelivered',
      ]);
      expect(published.every((e) => e.orderId === order.id)).toBe(true);
    });

    it('anularea repune stocul (comanda neplatita), iar produsul revine la stocul initial', async () => {
      await addToCart(keyboardId, 4);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      expect(await stockOf(keyboardId)).toBe(16);

      expect((await setStatus(order.id, 'CANCELLED')).status).toBe(200);

      expect(await stockOf(keyboardId)).toBe(20);
      expect(published.map((e) => e.type)).toEqual(['OrderPlaced', 'OrderCancelled']);
    });

    it('anularea unei comenzi platite repune stocul; rambursarea nu il repune a doua oara', async () => {
      await addToCart(keyboardId, 4);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      await setStatus(order.id, 'PAID');
      await setStatus(order.id, 'CANCELLED');
      expect(await stockOf(keyboardId)).toBe(20);

      expect((await setStatus(order.id, 'REFUNDED')).status).toBe(200);

      expect(await stockOf(keyboardId)).toBe(20);
    });

    it('a doua anulare a aceleiasi comenzi: 422 si stocul nu creste a doua oara', async () => {
      await addToCart(keyboardId, 4);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      await setStatus(order.id, 'CANCELLED');

      const again = await setStatus(order.id, 'CANCELLED');

      expect(again.status).toBe(422);
      expect(again.body).toMatchObject({ error: { code: 'INVALID_ORDER_TRANSITION' } });
      expect(await stockOf(keyboardId)).toBe(20);
      expect(published.filter((e) => e.type === 'OrderCancelled')).toHaveLength(1);
    });

    it('anularea unei comenzi cu pachet repune stocul componentelor', async () => {
      const bundle = await as(admin)
        .post('/bundles')
        .send({
          name: 'Set',
          discountPercent: 0,
          items: [
            { productId: mouseId, quantity: 2 },
            { productId: keyboardId, quantity: 1 },
          ],
        });
      await addToCart((bundle.body as { id: string }).id, 3);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      expect([await stockOf(mouseId), await stockOf(keyboardId)]).toEqual([4, 17]);

      await setStatus(order.id, 'CANCELLED');

      expect([await stockOf(mouseId), await stockOf(keyboardId)]).toEqual([10, 20]);
    });

    it('stocul repus permite o noua comanda (ciclu complet: comanda, anulare, comanda)', async () => {
      const last = await createProduct('Ultima', 1_000, 1);
      await addToCart(last, 1);
      const first = orderResponseSchema.parse((await placeOrder()).body);
      // Stocul e 0: nici coșul nu mai accepta produsul.
      expect((await as(ana).post('/cart/items').send({ itemId: last, quantity: 1 })).status).toBe(
        409,
      );

      await setStatus(first.id, 'CANCELLED');

      await addToCart(last, 1);
      expect((await placeOrder()).status).toBe(201);
      expect(await stockOf(last)).toBe(0);
    });

    it('un abonat defect nu strica plasarea, schimbarea de status si nici repunerea stocului', async () => {
      const failing = new InMemoryEventBus(silentLogger);
      failing.subscribe<OrderEvent>('OrderPlaced', () => {
        throw new Error('abonat stricat');
      });
      failing.subscribe<OrderEvent>('OrderPaid', () => Promise.reject(new Error('abonat stricat')));
      await setup(SETTINGS, failing);
      await addToCart(keyboardId, 2);

      const placed = await placeOrder();
      expect(placed.status).toBe(201);
      const order = orderResponseSchema.parse(placed.body);

      expect((await setStatus(order.id, 'PAID')).status).toBe(200);
      expect(
        orderResponseSchema.parse((await as(ana).get(`/orders/${order.id}`)).body).status,
      ).toBe('PAID');
      // Composition root inregistreaza abonatul de repunere pe orice magistrala primeste: ramane activ si langa abonatii defecti.
      expect(await stockOf(keyboardId)).toBe(18);
      expect((await setStatus(order.id, 'CANCELLED')).status).toBe(200);
      expect(await stockOf(keyboardId)).toBe(20);
    });

    it('cu magistrala implicita (cea din composition root), anularea repune stocul fara nicio configurare', async () => {
      ctx = buildTestApp({ ordering: SETTINGS });
      admin = await ctx.adminToken();
      ana = await ctx.customerToken('ana2@test.local');
      keyboardId = await createProduct('Tastatura', 10_000, 20);
      await addToCart(keyboardId, 5);
      const order = orderResponseSchema.parse((await placeOrder()).body);
      expect(await stockOf(keyboardId)).toBe(15);

      await setStatus(order.id, 'CANCELLED');

      expect(await stockOf(keyboardId)).toBe(20);
    });
  });
});
