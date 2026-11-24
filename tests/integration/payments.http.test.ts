import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPaymentFactories } from '../../src/composition-root';
import { openApiDocument } from '../../src/infrastructure/http/openapi';
import { orderResponseSchema } from '../../src/modules/ordering/adapters/http/orders.schemas';
import {
  ORDER_EVENT_TYPES,
  type OrderEvent,
} from '../../src/modules/ordering/domain/events/OrderEvents';
import { signCourierWebhook } from '../../src/modules/payments/adapters/providers/cod/CashOnDeliveryWebhookVerifier';
import { CashOnDeliveryFactory } from '../../src/modules/payments/adapters/providers/cod/CashOnDeliveryFactory';
import { CourierCodApi } from '../../src/modules/payments/adapters/providers/cod/CourierCodApi';
import { MOCK_AMOUNTS } from '../../src/modules/payments/adapters/providers/mock-support';
import { PayPalFactory } from '../../src/modules/payments/adapters/providers/paypal/PayPalFactory';
import { PayPalMockClient } from '../../src/modules/payments/adapters/providers/paypal/PayPalMockClient';
import { signPayPalWebhook } from '../../src/modules/payments/adapters/providers/paypal/PayPalWebhookVerifier';
import { StripeFactory } from '../../src/modules/payments/adapters/providers/stripe/StripeFactory';
import { StripeMockApi } from '../../src/modules/payments/adapters/providers/stripe/StripeMockApi';
import { signStripeWebhook } from '../../src/modules/payments/adapters/providers/stripe/StripeWebhookVerifier';
import { paymentResponseSchema } from '../../src/modules/payments/adapters/http/payments.schemas';
import { InMemoryEventBus } from '../../src/shared';
import { TEST_WEBHOOK_SECRET, bearer, buildTestApp, type TestApp } from '../helpers/app';
import { ADDRESS_PROPS } from '../helpers/order-fixtures';
import { silentLogger } from '../helpers/silent-logger';

type PaymentMethodName = 'CARD' | 'PAYPAL' | 'CASH_ON_DELIVERY';

describe('Plati (HTTP): plata, declin, dubla plata, anulare cu rambursare, webhook-uri', () => {
  let ctx: TestApp;
  let admin: string;
  let ana: string;
  let bob: string;
  let stripe: StripeMockApi;
  let paypal: PayPalMockClient;
  let courier: CourierCodApi;
  let published: OrderEvent[];

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
    stripe = new StripeMockApi();
    paypal = new PayPalMockClient();
    courier = new CourierCodApi();
    const events = new InMemoryEventBus(silentLogger);
    published = [];
    for (const type of ORDER_EVENT_TYPES) {
      events.subscribe<OrderEvent>(type, (event) => {
        published.push(event);
      });
    }
    ctx = buildTestApp({
      events,
      payments: {
        webhookSecret: TEST_WEBHOOK_SECRET,
        factories: [
          new StripeFactory(stripe, TEST_WEBHOOK_SECRET, () => new Date()),
          new PayPalFactory(paypal, TEST_WEBHOOK_SECRET, () => new Date()),
          new CashOnDeliveryFactory(courier, TEST_WEBHOOK_SECRET),
        ],
      },
    });
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    bob = await ctx.customerToken('bob@test.local');
  });

  /** Creeaza un produs de `amount` cenți (stoc 50) si intoarce id-ul. */
  const createProduct = async (amount: number, stock = 50): Promise<string> => {
    const response = await as(admin)
      .post('/products')
      .send({ name: `Produs ${amount}`, price: { amount, currency: 'RON' }, stock });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };

  const stockOf = async (id: string): Promise<number> =>
    ((await request(ctx.app).get(`/products/${id}`)).body as { stock: number }).stock;

  /** Plaseaza o comanda NEW cu un singur produs de `amount` cenți; intoarce id-ul comenzii si al produsului. */
  const placeOrder = async (
    amount: number,
    method: PaymentMethodName = 'CARD',
    token = ana,
    quantity = 1,
  ) => {
    const productId = await createProduct(amount);
    expect((await as(token).post('/cart/items').send({ itemId: productId, quantity })).status).toBe(
      200,
    );
    const response = await as(token)
      .post('/orders')
      .send({ address: ADDRESS_PROPS, deliveryMethod: 'STANDARD', paymentMethod: method });
    expect(response.status).toBe(201);
    return { orderId: orderResponseSchema.parse(response.body).id, productId };
  };

  const pay = (orderId: string, token = ana) => as(token).post(`/orders/${orderId}/payment`);
  const paymentOf = (orderId: string, token = ana) => as(token).get(`/orders/${orderId}/payment`);
  const orderOf = async (orderId: string) =>
    orderResponseSchema.parse((await as(ana).get(`/orders/${orderId}`)).body);

  describe('plata reusita', () => {
    it('POST /orders/:id/payment incaseaza, intoarce plata CAPTURED, iar comanda devine PAID cu paidAt', async () => {
      const { orderId } = await placeOrder(20_000);

      const response = await pay(orderId);

      expect(response.status).toBe(201);
      const payment = paymentResponseSchema.parse(response.body);
      expect(payment).toMatchObject({
        orderId,
        provider: 'STRIPE',
        status: 'CAPTURED',
        amount: { amount: 20_000, currency: 'RON' },
        failureReason: null,
      });
      expect(payment.externalId).toMatch(/^pi_mock_/);
      expect(response.body).not.toHaveProperty('idempotencyKey');
      expect(stripe.capturedIntents()).toHaveLength(1);

      const order = await orderOf(orderId);
      expect(order.status).toBe('PAID');
      expect(order.paidAt).not.toBeNull();
    });

    it('emite OrderPaid pe magistrala de evenimente (abonatii o vad)', async () => {
      const { orderId } = await placeOrder(5_000);

      await pay(orderId);

      expect(published.map((event) => event.type)).toEqual(['OrderPlaced', 'OrderPaid']);
      expect(published[1]).toMatchObject({ orderId });
    });

    it('GET /orders/:id/payment intoarce aceeasi plata (proprietarul si ADMIN)', async () => {
      const { orderId } = await placeOrder(5_000);
      const created = paymentResponseSchema.parse((await pay(orderId)).body);

      expect(paymentResponseSchema.parse((await paymentOf(orderId)).body)).toEqual(created);
      expect(paymentResponseSchema.parse((await paymentOf(orderId, admin)).body)).toEqual(created);
    });

    it.each([
      ['PAYPAL', 'PAYPAL', /^PP-CAP-/],
      ['CASH_ON_DELIVERY', 'COD', /^COD-T/],
    ] as const)('metoda %s se plateste prin furnizorul %s', async (method, provider, idPattern) => {
      const { orderId } = await placeOrder(9_900, method);

      const response = await pay(orderId);

      expect(response.status).toBe(201);
      const payment = paymentResponseSchema.parse(response.body);
      expect(payment).toMatchObject({ provider, status: 'CAPTURED' });
      expect(payment.externalId).toMatch(idPattern);
      expect((await orderOf(orderId)).status).toBe('PAID');
    });

    it('suma platita este totalul comenzii (cu reducere si TVA), nu pretul produselor', async () => {
      const vatCtx = buildTestApp({
        ordering: {
          pricing: { vatPercent: 19, discountTiers: [] },
          allowedCountries: ['MD'],
          maxOrderAmountCents: 100_000_000,
          fraud: { maxOrdersPerWindow: 1000, windowMs: 60_000, suspiciousAmountCents: 100_000_000 },
        },
      });
      const vatAdmin = await vatCtx.adminToken();
      const vatAna = await vatCtx.customerToken('ana@test.local');
      const product = await request(vatCtx.app)
        .post('/products')
        .set(...bearer(vatAdmin))
        .send({ name: 'P', price: { amount: 10_000, currency: 'RON' }, stock: 5 });
      const itemId = (product.body as { id: string }).id;
      await request(vatCtx.app)
        .post('/cart/items')
        .set(...bearer(vatAna))
        .send({ itemId, quantity: 1 });
      const order = await request(vatCtx.app)
        .post('/orders')
        .set(...bearer(vatAna))
        .send({ address: ADDRESS_PROPS, deliveryMethod: 'STANDARD', paymentMethod: 'CARD' });
      const orderId = (order.body as { id: string }).id;

      const response = await request(vatCtx.app)
        .post(`/orders/${orderId}/payment`)
        .set(...bearer(vatAna));

      expect(response.status).toBe(201);
      expect(paymentResponseSchema.parse(response.body).amount.amount).toBe(11_900); // 100.00 + 19% TVA
    });
  });

  describe('acces', () => {
    it('fara token: 401 la plata si la stare', async () => {
      const { orderId } = await placeOrder(5_000);
      expect((await request(ctx.app).post(`/orders/${orderId}/payment`)).status).toBe(401);
      expect((await request(ctx.app).get(`/orders/${orderId}/payment`)).status).toBe(401);
    });

    it('comanda altcuiva: 404 (nu se confirma ca exista), fara nicio incasare; nici ADMIN nu plateste in locul clientului', async () => {
      const { orderId } = await placeOrder(5_000);

      expect((await pay(orderId, bob)).status).toBe(404);
      expect((await pay(orderId, admin)).status).toBe(404);
      expect((await paymentOf(orderId, bob)).status).toBe(404);

      expect(stripe.capturedIntents()).toHaveLength(0);
      expect((await orderOf(orderId)).status).toBe('NEW');
    });

    it('id invalid: 400; comanda inexistenta: 404; comanda fara plata: 404 la stare', async () => {
      expect((await pay('nu-e-uuid')).status).toBe(400);
      expect((await pay('00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
      const { orderId } = await placeOrder(5_000);
      expect((await paymentOf(orderId)).status).toBe(404);
    });
  });

  describe('card refuzat si erori de furnizor', () => {
    it('suma speciala 666.01: 422 PAYMENT_DECLINED, plata DECLINED cu motivul, comanda ramane NEW', async () => {
      const { orderId } = await placeOrder(MOCK_AMOUNTS.DECLINE);

      const response = await pay(orderId);

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'PAYMENT_DECLINED' } });
      const payment = paymentResponseSchema.parse((await paymentOf(orderId)).body);
      expect(payment).toMatchObject({ status: 'DECLINED', failureReason: 'card_declined' });
      expect((await orderOf(orderId)).status).toBe('NEW');
      expect(stripe.capturedIntents()).toHaveLength(0);
    });

    it('suma speciala 666.02: 502 PAYMENT_PROVIDER_ERROR, plata FAILED', async () => {
      const { orderId } = await placeOrder(MOCK_AMOUNTS.PROVIDER_ERROR);

      const response = await pay(orderId);

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({ error: { code: 'PAYMENT_PROVIDER_ERROR' } });
      expect(paymentResponseSchema.parse((await paymentOf(orderId)).body)).toMatchObject({
        status: 'FAILED',
        failureReason: 'provider_error',
      });
    });

    it('suma speciala 666.03: 504 PAYMENT_PROVIDER_TIMEOUT, plata FAILED', async () => {
      const { orderId } = await placeOrder(MOCK_AMOUNTS.TIMEOUT);

      const response = await pay(orderId);

      expect(response.status).toBe(504);
      expect(response.body).toMatchObject({ error: { code: 'PAYMENT_PROVIDER_TIMEOUT' } });
      expect(paymentResponseSchema.parse((await paymentOf(orderId)).body)).toMatchObject({
        status: 'FAILED',
        failureReason: 'provider_timeout',
      });
    });

    it.each([
      ['PAYPAL', 'instrument_declined'],
      ['CASH_ON_DELIVERY', 'cod_rejected'],
    ] as const)('refuzul %s are motivul lui, tradus de adaptor (%s)', async (method, reason) => {
      const { orderId } = await placeOrder(MOCK_AMOUNTS.DECLINE, method);

      expect((await pay(orderId)).status).toBe(422);
      expect(paymentResponseSchema.parse((await paymentOf(orderId)).body).failureReason).toBe(
        reason,
      );
    });

    it('suma peste plafonul rambursului: 422 AMOUNT_ABOVE_PROVIDER_LIMIT, furnizorul nu e apelat', async () => {
      const { orderId } = await placeOrder(500_001, 'CASH_ON_DELIVERY');

      const response = await pay(orderId);

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'AMOUNT_ABOVE_PROVIDER_LIMIT' } });
      expect(courier.collectedTickets()).toHaveLength(0);
    });
  });

  describe('dubla plata', () => {
    it('a doua cerere: 409 ORDER_ALREADY_PAID; o singura incasare', async () => {
      const { orderId } = await placeOrder(5_000);
      expect((await pay(orderId)).status).toBe(201);

      const second = await pay(orderId);

      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: { code: 'ORDER_ALREADY_PAID' } });
      expect(stripe.capturedIntents()).toHaveLength(1);
      expect(published.filter((event) => event.type === 'OrderPaid')).toHaveLength(1);
    });

    it('cereri HTTP simultane: exact una 201, restul 409, o singura incasare, comanda PAID o singura data', async () => {
      const { orderId } = await placeOrder(5_000);

      const responses = await Promise.all(Array.from({ length: 8 }, () => pay(orderId)));

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
      for (const conflict of responses.filter((r) => r.status === 409)) {
        expect(['PAYMENT_IN_PROGRESS', 'ORDER_ALREADY_PAID']).toContain(
          (conflict.body as { error: { code: string } }).error.code,
        );
      }
      expect(stripe.capturedIntents()).toHaveLength(1);
      expect(published.filter((event) => event.type === 'OrderPaid')).toHaveLength(1);
    });

    it('o comanda marcata PAID manual de ADMIN nu se mai plateste: 409', async () => {
      const { orderId } = await placeOrder(5_000);
      expect(
        (await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'PAID' })).status,
      ).toBe(200);

      const response = await pay(orderId);

      expect(response.status).toBe(409);
      expect(stripe.capturedIntents()).toHaveLength(0);
    });

    it('o comanda anulata inainte de plata nu se mai poate plati: 409 ORDER_NOT_PAYABLE', async () => {
      const { orderId } = await placeOrder(5_000);
      await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'CANCELLED' });

      const response = await pay(orderId);

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'ORDER_NOT_PAYABLE' } });
      expect(stripe.capturedIntents()).toHaveLength(0);
    });
  });

  describe('anularea unei comenzi platite ramburseaza plata (Observer pe OrderCancelled)', () => {
    it('ADMIN anuleaza: plata devine REFUNDED, comanda REFUNDED, banii se returneaza, stocul se repune', async () => {
      const { orderId, productId } = await placeOrder(12_000, 'CARD', ana, 3);
      expect(await stockOf(productId)).toBe(47);
      await pay(orderId);

      const cancel = await as(admin)
        .patch(`/orders/${orderId}/status`)
        .send({ status: 'CANCELLED' });

      expect(cancel.status).toBe(200);
      expect((await orderOf(orderId)).status).toBe('REFUNDED');
      const payment = paymentResponseSchema.parse((await paymentOf(orderId)).body);
      expect(payment.status).toBe('REFUNDED');
      expect(stripe.issuedRefunds()).toHaveLength(1);
      expect(stripe.issuedRefunds()[0]).toMatchObject({
        amount: 36_000,
        payment_intent: payment.externalId,
      });
      expect(await stockOf(productId)).toBe(50);
      expect(published.map((event) => event.type)).toEqual([
        'OrderPlaced',
        'OrderPaid',
        'OrderCancelled',
        'OrderRefunded',
      ]);
    });

    it('a doua anulare nu mai ramburseaza (tranzitie invalida) si nici o repetare a evenimentului', async () => {
      const { orderId } = await placeOrder(5_000);
      await pay(orderId);
      await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'CANCELLED' });

      const again = await as(admin)
        .patch(`/orders/${orderId}/status`)
        .send({ status: 'CANCELLED' });

      expect(again.status).toBe(422);
      expect(stripe.issuedRefunds()).toHaveLength(1);
    });

    it('anularea unei comenzi neplatite: fara plata, fara rambursare, comanda ramane CANCELLED', async () => {
      const { orderId } = await placeOrder(5_000);

      await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'CANCELLED' });

      expect((await orderOf(orderId)).status).toBe('CANCELLED');
      expect((await paymentOf(orderId)).status).toBe(404);
      expect(stripe.issuedRefunds()).toHaveLength(0);
    });

    it.each([
      ['PAYPAL', () => paypal.issuedRefunds().length],
      [
        'CASH_ON_DELIVERY',
        () => courier.collectedTickets().filter((t) => courier.refundedMinor(t) > 0).length,
      ],
    ] as const)('%s: rambursarea ajunge la furnizorul potrivit', async (method, refundsDone) => {
      const { orderId } = await placeOrder(8_000, method);
      await pay(orderId);

      await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'CANCELLED' });

      expect((await orderOf(orderId)).status).toBe('REFUNDED');
      expect(refundsDone()).toBe(1);
    });

    it('rambursare refuzata de furnizor (666.04): anularea reuseste, comanda ramane CANCELLED, plata CAPTURED (de reluat)', async () => {
      const { orderId } = await placeOrder(MOCK_AMOUNTS.REFUND_FAILURE);
      await pay(orderId);

      const cancel = await as(admin)
        .patch(`/orders/${orderId}/status`)
        .send({ status: 'CANCELLED' });

      expect(cancel.status).toBe(200);
      expect((await orderOf(orderId)).status).toBe('CANCELLED');
      expect(paymentResponseSchema.parse((await paymentOf(orderId)).body).status).toBe('CAPTURED');
    });

    it('o comanda marcata PAID manual (fara plata) se anuleaza fara eroare si fara rambursare', async () => {
      const { orderId } = await placeOrder(5_000);
      await as(admin).patch(`/orders/${orderId}/status`).send({ status: 'PAID' });

      const cancel = await as(admin)
        .patch(`/orders/${orderId}/status`)
        .send({ status: 'CANCELLED' });

      expect(cancel.status).toBe(200);
      expect((await orderOf(orderId)).status).toBe('CANCELLED');
      expect(stripe.issuedRefunds()).toHaveLength(0);
    });
  });

  describe('webhook-uri', () => {
    const postWebhook = (provider: string, body: string, headers: Record<string, string>) =>
      request(ctx.app)
        .post(`/payments/webhooks/${provider}`)
        .set({ 'Content-Type': 'application/json', ...headers })
        .send(body);

    const stripeHeaders = (body: string, secret = TEST_WEBHOOK_SECRET) => ({
      'stripe-signature': signStripeWebhook(secret, body, Math.floor(Date.now() / 1000)),
    });

    const paidPayment = async (method: PaymentMethodName = 'CARD') => {
      const { orderId } = await placeOrder(5_000, method);
      return paymentResponseSchema.parse((await pay(orderId)).body);
    };

    it('Stripe: un mesaj semnat corect e acceptat fara token si se potriveste cu plata', async () => {
      const payment = await paidPayment();
      const body = JSON.stringify({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: payment.externalId } },
      });

      const response = await postWebhook('stripe', body, stripeHeaders(body));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true, matched: true, paymentStatus: 'CAPTURED' });
    });

    it('semnatura se verifica pe octetii primiti, nu pe JSON re-serializat (spatii si ordine a cheilor pastrate)', async () => {
      const payment = await paidPayment();
      const body = `{ "type" :"payment_intent.succeeded",\n  "data":{"object":{"id":"${payment.externalId}"}},   "id":"evt_9" }`;

      const response = await postWebhook('stripe', body, stripeHeaders(body));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ matched: true });
    });

    it('PayPal: antetele paypal-transmission-* semnate corect sunt acceptate', async () => {
      const payment = await paidPayment('PAYPAL');
      const body = JSON.stringify({
        id: 'WH-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: payment.externalId },
      });

      const response = await postWebhook(
        'paypal',
        body,
        signPayPalWebhook(
          TEST_WEBHOOK_SECRET,
          { id: 'TX-1', time: new Date().toISOString() },
          body,
        ),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ matched: true, paymentStatus: 'CAPTURED' });
    });

    it('ramburs: X-Courier-Signature semnat corect e acceptat', async () => {
      const payment = await paidPayment('CASH_ON_DELIVERY');
      const body = JSON.stringify({
        eventId: 'c-1',
        kind: 'CASH_COLLECTED',
        ticket: payment.externalId,
      });

      const response = await postWebhook('cod', body, {
        'x-courier-signature': signCourierWebhook(TEST_WEBHOOK_SECRET, body),
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ matched: true });
    });

    it('semnatura gresita sau lipsa: 403 INVALID_WEBHOOK_SIGNATURE', async () => {
      const body = JSON.stringify({
        id: 'evt',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'x' } },
      });

      const wrongSecret = await postWebhook(
        'stripe',
        body,
        stripeHeaders(body, 'alt-secret-de-16-caractere'),
      );
      const missing = await postWebhook('stripe', body, {});
      const tampered = await postWebhook('stripe', `${body} `, stripeHeaders(body));

      for (const response of [wrongSecret, missing, tampered]) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: { code: 'INVALID_WEBHOOK_SIGNATURE' } });
      }
    });

    it('antetele de semnatura ale unui furnizor nu sunt valide pe ruta altuia', async () => {
      const body = JSON.stringify({
        id: 'evt',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'x' } },
      });

      for (const provider of ['paypal', 'cod']) {
        expect((await postWebhook(provider, body, stripeHeaders(body))).status).toBe(403);
      }
    });

    it('semnat corect, dar fara formatul furnizorului: 422 INVALID_WEBHOOK_PAYLOAD', async () => {
      const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: {} });

      const response = await postWebhook('stripe', body, stripeHeaders(body));

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_WEBHOOK_PAYLOAD' } });
    });

    it('furnizor necunoscut in URL: 400; JSON malformat: 400', async () => {
      expect((await postWebhook('nu-exista', '{}', {})).status).toBe(400);
      expect((await postWebhook('stripe', '{nu e json', {})).status).toBe(400);
    });

    it('un webhook nu modifica plata sau comanda (doar reconciliaza)', async () => {
      const payment = await paidPayment();
      const body = JSON.stringify({
        id: 'evt_f',
        type: 'payment_intent.payment_failed',
        data: { object: { id: payment.externalId } },
      });

      const response = await postWebhook('stripe', body, stripeHeaders(body));

      expect(response.status).toBe(200);
      expect(paymentResponseSchema.parse((await paymentOf(payment.orderId)).body).status).toBe(
        'CAPTURED',
      );
      expect((await orderOf(payment.orderId)).status).toBe('PAID');
    });
  });

  describe('implicit, furnizorii sunt mock-urile locale', () => {
    it('createMockPaymentFactories construieste cele trei familii, pe metodele CARD / PAYPAL / CASH_ON_DELIVERY', () => {
      expect(
        createMockPaymentFactories(TEST_WEBHOOK_SECRET).map((f) => [f.provider, f.method]),
      ).toEqual([
        ['STRIPE', 'CARD'],
        ['PAYPAL', 'PAYPAL'],
        ['COD', 'CASH_ON_DELIVERY'],
      ]);
    });

    it('aplicatia fara fabrici explicite plateste prin mock-urile implicite', async () => {
      const defaults = buildTestApp();
      const token = await defaults.customerToken('zoe@test.local');
      const adminToken = await defaults.adminToken();
      const productId = (
        (
          await request(defaults.app)
            .post('/products')
            .set(...bearer(adminToken))
            .send({ name: 'P', price: { amount: 3_000, currency: 'RON' }, stock: 2 })
        ).body as { id: string }
      ).id;
      await request(defaults.app)
        .post('/cart/items')
        .set(...bearer(token))
        .send({ itemId: productId, quantity: 1 });
      const orderId = (
        (
          await request(defaults.app)
            .post('/orders')
            .set(...bearer(token))
            .send({ address: ADDRESS_PROPS, deliveryMethod: 'STANDARD', paymentMethod: 'PAYPAL' })
        ).body as { id: string }
      ).id;

      const response = await request(defaults.app)
        .post(`/orders/${orderId}/payment`)
        .set(...bearer(token));

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ provider: 'PAYPAL', status: 'CAPTURED' });
    });
  });

  describe('documentatie OpenAPI', () => {
    it('descrie plata, starea platii si webhook-ul, cu schema Payment', () => {
      const paths = openApiDocument['paths'] as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/orders/{id}/payment'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/payments/webhooks/{provider}'] ?? {})).toEqual(['post']);
      const schemas = (openApiDocument['components'] as { schemas: Record<string, unknown> })
        .schemas;
      expect(schemas).toHaveProperty('Payment');
      expect(schemas).toHaveProperty('WebhookResult');
    });

    it('/docs ruleaza si pagina Swagger se incarca', async () => {
      expect((await request(ctx.app).get('/docs/')).status).toBe(200);
    });
  });
});
