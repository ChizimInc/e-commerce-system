import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockCouriers } from '../../src/composition-root';
import { openApiDocument } from '../../src/infrastructure/http/openapi';
import { orderResponseSchema } from '../../src/modules/ordering/adapters/http/orders.schemas';
import {
  ORDER_EVENT_TYPES,
  type OrderEvent,
} from '../../src/modules/ordering/domain/events/OrderEvents';
import {
  shipmentResponseSchema,
  shippingQuoteResponseSchema,
} from '../../src/modules/shipping/adapters/http/shipping.schemas';
import { STANDARD_SHIPPING_RATES } from '../../src/modules/shipping/domain/ShippingCostStrategy';
import { InMemoryEventBus } from '../../src/shared';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { ADDRESS_PROPS } from '../helpers/order-fixtures';
import { silentLogger } from '../helpers/silent-logger';

type DeliveryMethodName = 'STANDARD' | 'EXPRESS' | 'STORE_PICKUP';

const START = new Date('2026-06-01T10:00:00.000Z');
const HOUR = 60 * 60_000;

describe('Livrari (HTTP): cost in total, cotatie, expediere, urmarire, esecuri de curier', () => {
  let ctx: TestApp;
  let admin: string;
  let ana: string;
  let bob: string;
  let published: OrderEvent[];
  let now: Date;

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

  beforeEach(async () => {
    now = START;
    const clock = () => new Date(now);
    const events = new InMemoryEventBus(silentLogger);
    published = [];
    for (const type of ORDER_EVENT_TYPES) {
      events.subscribe<OrderEvent>(type, (event) => {
        published.push(event);
      });
    }
    ctx = buildTestApp({
      events,
      clock,
      // Tarifele reale ale magazinului; fara ele livrarea e gratuita (implicit pentru celelalte teste).
      shipping: { rates: STANDARD_SHIPPING_RATES, couriers: createMockCouriers(clock) },
    });
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    bob = await ctx.customerToken('bob@test.local');
  });

  /** Creeaza un produs de `amount` cenți (stoc 50) si intoarce id-ul. */
  const createProduct = async (amount: number): Promise<string> => {
    const response = await as(admin)
      .post('/products')
      .send({ name: `Produs ${amount}`, price: { amount, currency: 'RON' }, stock: 50 });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };

  const fillCart = async (amount: number, quantity = 1, token = ana): Promise<void> => {
    const productId = await createProduct(amount);
    const response = await as(token).post('/cart/items').send({ itemId: productId, quantity });
    expect(response.status).toBe(200);
  };

  const placeOrder = async (
    amount: number,
    deliveryMethod: DeliveryMethodName,
    { quantity = 1, postalCode }: { quantity?: number; postalCode?: string } = {},
  ) => {
    await fillCart(amount, quantity);
    const response = await as(ana)
      .post('/orders')
      .send({
        address: { ...ADDRESS_PROPS, ...(postalCode ? { postalCode } : {}) },
        deliveryMethod,
        paymentMethod: 'CARD',
      });
    expect(response.status).toBe(201);
    return orderResponseSchema.parse(response.body);
  };

  /** O comanda platita, gata de expediat. */
  const paidOrder = async (
    deliveryMethod: DeliveryMethodName,
    options: { amount?: number; quantity?: number; postalCode?: string } = {},
  ) => {
    const order = await placeOrder(options.amount ?? 20_000, deliveryMethod, options);
    expect((await as(ana).post(`/orders/${order.id}/payment`)).status).toBe(201);
    return order;
  };

  const ship = (orderId: string, token = admin) => as(token).post(`/orders/${orderId}/shipment`);
  const shipmentOf = (orderId: string, token = ana) => as(token).get(`/orders/${orderId}/shipment`);
  const statusOf = async (orderId: string) =>
    orderResponseSchema.parse((await as(ana).get(`/orders/${orderId}`)).body).status;

  describe('costul livrarii intra in totalul comenzii (Strategy + Decorator)', () => {
    it('STANDARD: cost fix; total = subtotal + livrare', async () => {
      const order = await placeOrder(20_000, 'STANDARD');

      expect(order.shipping).toEqual({ amount: 1_500, currency: 'RON' });
      expect(order.subtotal.amount).toBe(20_000);
      expect(order.total.amount).toBe(21_500);
    });

    it('STANDARD devine gratuit de la 300.00 valoare a marfii', async () => {
      const order = await placeOrder(30_000, 'STANDARD');

      expect(order.shipping.amount).toBe(0);
      expect(order.total.amount).toBe(30_000);
    });

    it('EXPRESS: cost de baza + supliment pe fiecare bucata dupa prima (nu e niciodata gratuit)', async () => {
      const order = await placeOrder(100_000, 'EXPRESS', { quantity: 3 });

      expect(order.shipping.amount).toBe(3_400); // 30.00 + 2 x 2.00
      expect(order.total.amount).toBe(303_400);
    });

    it('STORE_PICKUP: gratuit', async () => {
      const order = await placeOrder(5_000, 'STORE_PICKUP');

      expect(order.shipping.amount).toBe(0);
      expect(order.total.amount).toBe(5_000);
    });

    it('plata incaseaza totalul cu livrare inclusa', async () => {
      const order = await placeOrder(20_000, 'STANDARD');

      const payment = await as(ana).post(`/orders/${order.id}/payment`);

      expect(payment.status).toBe(201);
      expect((payment.body as { amount: { amount: number } }).amount.amount).toBe(21_500);
    });

    it('livrarea intra si in baza de calcul a TVA (calculul cu TVA si reducere ruleaza peste aceleasi decoratoare)', async () => {
      const local = buildTestApp({
        ordering: {
          pricing: { vatPercent: 19, discountTiers: [{ minSubtotalCents: 50_000, percent: 10 }] },
          allowedCountries: ['RO', 'MD'],
          maxOrderAmountCents: 2_147_483_647,
          fraud: {
            maxOrdersPerWindow: 1000,
            windowMs: 60_000,
            suspiciousAmountCents: 2_147_483_647,
          },
        },
        shipping: { rates: STANDARD_SHIPPING_RATES },
      });
      const localAdmin = await local.adminToken();
      const localAna = await local.customerToken('ana@test.local');
      const product = await request(local.app)
        .post('/products')
        .set(...bearer(localAdmin))
        .send({ name: 'Scump', price: { amount: 60_000, currency: 'RON' }, stock: 5 });
      await request(local.app)
        .post('/cart/items')
        .set(...bearer(localAna))
        .send({ itemId: (product.body as { id: string }).id, quantity: 1 });

      const response = await request(local.app)
        .post('/orders')
        .set(...bearer(localAna))
        .send({ address: ADDRESS_PROPS, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD' });
      const order = orderResponseSchema.parse(response.body);

      expect(order.discount.amount).toBe(6_000);
      expect(order.shipping.amount).toBe(3_000);
      // TVA 19% din (600.00 - 60.00 + 30.00) = 108.30
      expect(order.vat.amount).toBe(10_830);
      expect(order.total.amount).toBe(60_000 - 6_000 + 3_000 + 10_830);
    });
  });

  describe('GET /shipping/quote (cost inainte de checkout)', () => {
    it('intoarce costul fiecarei metode pentru cosul curent, cu curierul fiecareia', async () => {
      await fillCart(10_000, 2);

      const response = await as(ana).get('/shipping/quote');

      expect(response.status).toBe(200);
      const quote = shippingQuoteResponseSchema.parse(response.body);
      expect(quote.itemsValue.amount).toBe(20_000);
      expect(quote.units).toBe(2);
      expect(
        quote.options.map(({ deliveryMethod, courier, cost }) => [
          deliveryMethod,
          courier,
          cost.amount,
        ]),
      ).toEqual([
        ['STANDARD', 'POST_OFFICE', 1_500],
        ['EXPRESS', 'FAST_COURIER', 3_200],
        ['STORE_PICKUP', 'STORE_PICKUP', 0],
      ]);
    });

    it('cotatia e egala cu livrarea din comanda plasata ulterior, pentru fiecare metoda', async () => {
      for (const method of ['STANDARD', 'EXPRESS', 'STORE_PICKUP'] as const) {
        await fillCart(12_345, 3);
        const quote = shippingQuoteResponseSchema.parse(
          (await as(ana).get('/shipping/quote')).body,
        );
        const quoted = quote.options.find((o) => o.deliveryMethod === method)?.cost.amount;

        const response = await as(ana)
          .post('/orders')
          .send({ address: ADDRESS_PROPS, deliveryMethod: method, paymentMethod: 'CARD' });

        expect(orderResponseSchema.parse(response.body).shipping.amount).toBe(quoted);
      }
    });

    it('cere autentificare (401) si refuza un cos gol (422 CART_EMPTY)', async () => {
      expect((await request(ctx.app).get('/shipping/quote')).status).toBe(401);

      const empty = await as(bob).get('/shipping/quote');
      expect(empty.status).toBe(422);
      expect(empty.body).toMatchObject({ error: { code: 'CART_EMPTY' } });
    });
  });

  describe('expedierea comenzii (ADMIN): comanda -> plata -> expediere', () => {
    it.each([
      ['EXPRESS', 'FAST_COURIER'],
      ['STANDARD', 'POST_OFFICE'],
      ['STORE_PICKUP', 'STORE_PICKUP'],
    ] as const)(
      'o comanda %s platita se preda curierului %s, trece in SHIPPED si emite OrderShipped',
      async (method, courier) => {
        const order = await paidOrder(method);
        published.length = 0;

        const response = await ship(order.id);

        expect(response.status).toBe(201);
        const shipment = shipmentResponseSchema.parse(response.body);
        expect(shipment).toMatchObject({
          orderId: order.id,
          courier,
          status: 'CREATED',
          failureReason: null,
          cost: order.shipping,
        });
        expect(shipment.trackingNumber).toMatch(/\S+/);
        expect(shipment.externalId).toMatch(/\S+/);
        expect(await statusOf(order.id)).toBe('SHIPPED');
        expect(published.map((event) => event.type)).toEqual(['OrderShipped']);
        expect(published[0]).toMatchObject({ orderId: order.id, customerId: order.customerId });
      },
    );

    it('doar ADMIN expediaza: CUSTOMER (nici proprietarul) 403, anonim 401; comanda ramane PAID', async () => {
      const order = await paidOrder('EXPRESS');

      expect((await ship(order.id, ana)).status).toBe(403);
      expect((await request(ctx.app).post(`/orders/${order.id}/shipment`)).status).toBe(401);
      expect(await statusOf(order.id)).toBe('PAID');
      expect((await shipmentOf(order.id)).status).toBe(404);
    });

    it('doar o comanda PAID se expediaza: NEW si anulata dau 409 ORDER_NOT_SHIPPABLE; inexistenta 404', async () => {
      const unpaid = await placeOrder(20_000, 'EXPRESS');
      const response = await ship(unpaid.id);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'ORDER_NOT_SHIPPABLE' } });

      await as(admin).patch(`/orders/${unpaid.id}/status`).send({ status: 'CANCELLED' });
      expect((await ship(unpaid.id)).body).toMatchObject({
        error: { code: 'ORDER_NOT_SHIPPABLE' },
      });

      expect((await ship('00000000-0000-4000-8000-00000000dead')).status).toBe(404);
      expect((await ship('nu-e-uuid')).status).toBe(400);
    });

    it('nu poti expedia de doua ori: a doua cerere 409 ORDER_ALREADY_SHIPPED, un singur colet', async () => {
      const order = await paidOrder('EXPRESS');
      const first = shipmentResponseSchema.parse((await ship(order.id)).body);

      const second = await ship(order.id);

      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: { code: 'ORDER_ALREADY_SHIPPED' } });
      expect(shipmentResponseSchema.parse((await shipmentOf(order.id)).body).id).toBe(first.id);
      expect(published.filter((e) => e.type === 'OrderShipped')).toHaveLength(1);
    });

    it('cereri simultane de expediere: exact una reuseste (201), restul 409, un singur OrderShipped', async () => {
      const order = await paidOrder('STANDARD');
      published.length = 0;

      const responses = await Promise.all(Array.from({ length: 6 }, () => ship(order.id)));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
      expect(published.filter((e) => e.type === 'OrderShipped')).toHaveLength(1);
    });

    it('SHIPPED setat manual de ADMIN (PATCH) face expedierea prin curier 409 ORDER_ALREADY_SHIPPED', async () => {
      const order = await paidOrder('EXPRESS');
      await as(admin).patch(`/orders/${order.id}/status`).send({ status: 'SHIPPED' });

      const response = await ship(order.id);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'ORDER_ALREADY_SHIPPED' } });
    });
  });

  describe('starea livrarii (GET /orders/:id/shipment) si urmarirea', () => {
    it('proprietarul si ADMIN o vad; alt client primeste 404 (nu 403); anonim 401', async () => {
      const order = await paidOrder('EXPRESS');
      await ship(order.id);

      expect((await shipmentOf(order.id, ana)).status).toBe(200);
      expect((await shipmentOf(order.id, admin)).status).toBe(200);
      expect((await shipmentOf(order.id, bob)).status).toBe(404);
      expect((await request(ctx.app).get(`/orders/${order.id}/shipment`)).status).toBe(401);
    });

    it('o comanda neexpediata nu are livrare (404)', async () => {
      const order = await paidOrder('EXPRESS');

      expect((await shipmentOf(order.id)).status).toBe(404);
    });

    it('starea se reimprospateaza din urmarirea curierului: CREATED -> IN_TRANSIT -> DELIVERED (curierul rapid)', async () => {
      const order = await paidOrder('EXPRESS');
      await ship(order.id);
      const status = async () =>
        shipmentResponseSchema.parse((await shipmentOf(order.id)).body).status;

      expect(await status()).toBe('CREATED');
      now = new Date(now.getTime() + 2 * 60_000);
      expect(await status()).toBe('IN_TRANSIT');
      now = new Date(now.getTime() + 5 * HOUR);
      expect(await status()).toBe('DELIVERED');
      // starea finala se pastreaza
      expect(await status()).toBe('DELIVERED');
    });

    it('posta (STANDARD) e mai lenta decat curierul rapid', async () => {
      const order = await paidOrder('STANDARD');
      await ship(order.id);

      now = new Date(now.getTime() + 2 * 60_000);
      expect(shipmentResponseSchema.parse((await shipmentOf(order.id)).body).status).toBe(
        'CREATED',
      );
      now = new Date(now.getTime() + 2 * HOUR);
      expect(shipmentResponseSchema.parse((await shipmentOf(order.id)).body).status).toBe(
        'IN_TRANSIT',
      );
    });
  });

  describe('esecuri la curier (adrese speciale ale mock-urilor)', () => {
    it.each([
      ['00000', 422, 'SHIPMENT_REJECTED', 'address_not_serviceable'],
      ['00001', 502, 'COURIER_ERROR', 'courier_error'],
      ['00002', 504, 'COURIER_TIMEOUT', 'courier_timeout'],
    ])(
      'codul postal %s: %i %s; livrarea se salveaza FAILED, comanda ramane PAID, fara OrderShipped',
      async (postalCode, status, code, reason) => {
        // aceleasi coduri pe ambii curieri (rapid si posta)
        for (const method of ['EXPRESS', 'STANDARD'] as const) {
          const order = await paidOrder(method, { postalCode });
          published.length = 0;

          const response = await ship(order.id);

          expect(response.status).toBe(status);
          expect(response.body).toMatchObject({ error: { code } });
          expect(shipmentResponseSchema.parse((await shipmentOf(order.id)).body)).toMatchObject({
            status: 'FAILED',
            failureReason: reason,
            externalId: null,
          });
          expect(await statusOf(order.id)).toBe('PAID');
          expect(published.filter((e) => e.type === 'OrderShipped')).toHaveLength(0);
        }
      },
    );

    it('o expediere esuata se poate relua (si esueaza din nou, controlat, pe aceeasi adresa)', async () => {
      const order = await paidOrder('EXPRESS', { postalCode: '00002' });
      expect((await ship(order.id)).status).toBe(504);
      const failedId = shipmentResponseSchema.parse((await shipmentOf(order.id)).body).id;

      expect((await ship(order.id)).status).toBe(504);

      const after = shipmentResponseSchema.parse((await shipmentOf(order.id)).body);
      expect(after).toMatchObject({ id: failedId, status: 'FAILED' });
    });

    it.each([
      // STANDARD e gratuit de la 300.00, deci totalul e chiar pretul produsului; EXPRESS adauga 30.00 pentru o bucata
      ['STANDARD', 77_701, 422, 'SHIPMENT_REJECTED'],
      ['STANDARD', 77_702, 502, 'COURIER_ERROR'],
      ['STANDARD', 77_703, 504, 'COURIER_TIMEOUT'],
      ['EXPRESS', 74_701, 422, 'SHIPMENT_REJECTED'],
    ] as const)(
      'valoarea declarata speciala (%s, produs %i cenți): %i %s',
      async (method, amount, status, code) => {
        const order = await paidOrder(method, { amount });
        expect([order.total.amount - order.shipping.amount, amount]).toEqual([amount, amount]);

        const response = await ship(order.id);

        expect(response.status).toBe(status);
        expect(response.body).toMatchObject({ error: { code } });
      },
    );
  });

  describe('documentatie OpenAPI', () => {
    it('expune rutele de livrare si schemele lor', () => {
      const paths = Object.keys((openApiDocument as { paths: object }).paths);
      expect(paths).toEqual(expect.arrayContaining(['/shipping/quote', '/orders/{id}/shipment']));
      const schemas = Object.keys(
        (openApiDocument as { components: { schemas: object } }).components.schemas,
      );
      expect(schemas).toEqual(expect.arrayContaining(['Shipment', 'ShippingQuote']));
    });

    it('comanda din OpenAPI are campul `shipping`', () => {
      const order = (
        openApiDocument as {
          components: { schemas: { Order: { properties: Record<string, unknown> } } };
        }
      ).components.schemas.Order;
      expect(Object.keys(order.properties)).toContain('shipping');
    });
  });
});
