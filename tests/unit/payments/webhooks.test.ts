import { describe, expect, it } from 'vitest';
import {
  CashOnDeliveryWebhookVerifier,
  signCourierWebhook,
} from '../../../src/modules/payments/adapters/providers/cod/CashOnDeliveryWebhookVerifier';
import {
  PayPalWebhookVerifier,
  signPayPalWebhook,
} from '../../../src/modules/payments/adapters/providers/paypal/PayPalWebhookVerifier';
import {
  StripeWebhookVerifier,
  signStripeWebhook,
} from '../../../src/modules/payments/adapters/providers/stripe/StripeWebhookVerifier';
import {
  InvalidWebhookPayloadError,
  InvalidWebhookSignatureError,
} from '../../../src/modules/payments/domain/errors';
import { HandlePaymentWebhook } from '../../../src/modules/payments/application/HandlePaymentWebhook';
import type {
  WebhookHeaders,
  WebhookVerifier,
} from '../../../src/modules/payments/ports/out/WebhookVerifier';
import { ConsoleLogger } from '../../../src/shared';
import { buildPaymentsHarness, owner, START, WEBHOOK_SECRET } from '../../helpers/payments-harness';

const seconds = START.getTime() / 1000;

interface Scenario {
  name: string;
  verifier: WebhookVerifier;
  /** Un mesaj semnat corect pentru `payload`, cu antetele furnizorului. */
  sign: (payload: object, secret?: string, at?: Date) => { body: Buffer; headers: WebhookHeaders };
  captured: object;
  refunded: object;
  failed: object;
  unknown: object;
  /** Eveniment cunoscut, dar fara campurile cu id-ul tranzactiei. */
  incomplete: object;
  externalId: string;
}

const scenarios: Scenario[] = [
  {
    name: 'Stripe',
    verifier: new StripeWebhookVerifier(WEBHOOK_SECRET, () => START),
    sign: (payload, secret = WEBHOOK_SECRET, at = START) => {
      const body = JSON.stringify(payload);
      return {
        body: Buffer.from(body),
        headers: { 'stripe-signature': signStripeWebhook(secret, body, at.getTime() / 1000) },
      };
    },
    captured: { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } },
    refunded: {
      id: 'evt_2',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1' } },
    },
    failed: {
      id: 'evt_3',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_1' } },
    },
    unknown: { id: 'evt_4', type: 'customer.created', data: { object: { id: 'cus_1' } } },
    incomplete: { id: 'evt_5', type: 'payment_intent.succeeded', data: { object: {} } },
    externalId: 'pi_1',
  },
  {
    name: 'PayPal',
    verifier: new PayPalWebhookVerifier(WEBHOOK_SECRET, () => START),
    sign: (payload, secret = WEBHOOK_SECRET, at = START) => {
      const body = JSON.stringify(payload);
      return {
        body: Buffer.from(body),
        headers: signPayPalWebhook(secret, { id: 'TX-1', time: at.toISOString() }, body),
      };
    },
    captured: { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'PP-CAP-1' } },
    refunded: {
      id: 'WH-2',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: 'PP-REF-1', capture_id: 'PP-CAP-1' },
    },
    failed: { id: 'WH-3', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { id: 'PP-CAP-1' } },
    unknown: { id: 'WH-4', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { id: 'D-1' } },
    incomplete: { id: 'WH-5', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} },
    externalId: 'PP-CAP-1',
  },
  {
    name: 'ramburs',
    verifier: new CashOnDeliveryWebhookVerifier(WEBHOOK_SECRET),
    sign: (payload, secret = WEBHOOK_SECRET) => {
      const body = JSON.stringify(payload);
      return {
        body: Buffer.from(body),
        headers: { 'x-courier-signature': signCourierWebhook(secret, body) },
      };
    },
    captured: { eventId: 'c-1', kind: 'CASH_COLLECTED', ticket: 'COD-T00001' },
    refunded: { eventId: 'c-2', kind: 'CASH_RETURNED', ticket: 'COD-T00001' },
    failed: { eventId: 'c-3', kind: 'DELIVERY_FAILED', ticket: 'COD-T00001' },
    unknown: { eventId: 'c-4', kind: 'PARCEL_SCANNED', ticket: 'COD-T00001' },
    incomplete: { eventId: 'c-5', kind: 'CASH_COLLECTED' },
    externalId: 'COD-T00001',
  },
];

describe.each(scenarios)('WebhookVerifier $name', (scenario) => {
  const { verifier, sign } = scenario;

  it.each([
    ['captured', 'CAPTURED'],
    ['refunded', 'REFUNDED'],
    ['failed', 'FAILED'],
  ] as const)('un mesaj semnat corect (%s) devine un eveniment normalizat %s', (key, kind) => {
    const { body, headers } = sign(scenario[key]);
    expect(verifier.verify(body, headers)).toMatchObject({ kind, externalId: scenario.externalId });
  });

  it('un tip de eveniment necunoscut e IGNORED (se confirma, dar nu se foloseste)', () => {
    const { body, headers } = sign(scenario.unknown);
    expect(verifier.verify(body, headers)).toMatchObject({ kind: 'IGNORED', externalId: null });
  });

  it('refuza un mesaj semnat cu alt secret', () => {
    const { body, headers } = sign(scenario.captured, 'alt-secret-de-16-caractere');
    expect(() => verifier.verify(body, headers)).toThrowError(InvalidWebhookSignatureError);
  });

  it('refuza un corp modificat dupa semnare', () => {
    const { body, headers } = sign(scenario.captured);
    const tampered = Buffer.from(body.toString('utf8').replace('1', '2'));
    expect(() => verifier.verify(tampered, headers)).toThrowError(InvalidWebhookSignatureError);
  });

  it('refuza un mesaj fara antetele de semnatura', () => {
    const { body } = sign(scenario.captured);
    expect(() => verifier.verify(body, {})).toThrowError(InvalidWebhookSignatureError);
  });

  it('refuza o semnatura goala sau aiurea', () => {
    const { body, headers } = sign(scenario.captured);
    const broken = Object.fromEntries(Object.keys(headers).map((name) => [name, 'aiurea']));
    expect(() => verifier.verify(body, broken)).toThrowError(InvalidWebhookSignatureError);
  });

  it('un corp semnat corect, dar care nu e JSON, e payload invalid (nu semnatura)', () => {
    const rawBody = 'nu e json';
    const headers = {
      Stripe: { 'stripe-signature': signStripeWebhook(WEBHOOK_SECRET, rawBody, seconds) },
      PayPal: signPayPalWebhook(WEBHOOK_SECRET, { id: 'TX', time: START.toISOString() }, rawBody),
      ramburs: { 'x-courier-signature': signCourierWebhook(WEBHOOK_SECRET, rawBody) },
    }[scenario.name as 'Stripe' | 'PayPal' | 'ramburs'];

    expect(() => verifier.verify(Buffer.from(rawBody), headers)).toThrowError(
      InvalidWebhookPayloadError,
    );
  });

  it('un eveniment cunoscut fara id-ul tranzactiei e payload invalid', () => {
    const { body, headers } = sign(scenario.incomplete);
    expect(() => verifier.verify(body, headers)).toThrowError(InvalidWebhookPayloadError);
  });

  it('nu accepta antetele altui furnizor', () => {
    const other = scenarios.find((s) => s.name !== scenario.name);
    const foreign = other?.sign(other.captured);
    expect(foreign).toBeDefined();
    expect(() =>
      verifier.verify(foreign?.body ?? Buffer.alloc(0), foreign?.headers ?? {}),
    ).toThrowError(InvalidWebhookSignatureError);
  });
});

describe('protectia la reluari (Stripe si PayPal semneaza si momentul)', () => {
  const MINUTE = 60_000;

  it.each(scenarios.filter((s) => s.name !== 'ramburs'))(
    '$name: accepta un mesaj de acum 4 minute, refuza unul de acum 6 minute sau din viitorul indepartat',
    (scenario) => {
      const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);
      const attempt = (date: Date) => {
        const { body, headers } = scenario.sign(scenario.captured, WEBHOOK_SECRET, date);
        return () => scenario.verifier.verify(body, headers);
      };

      expect(attempt(at(-4 * MINUTE))).not.toThrow();
      expect(attempt(at(-6 * MINUTE))).toThrowError(InvalidWebhookSignatureError);
      expect(attempt(at(6 * MINUTE))).toThrowError(InvalidWebhookSignatureError);
    },
  );

  it('Stripe: un timestamp care nu e numar nu trece', () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, () => START);
    expect(() =>
      verifier.verify(Buffer.from('{}'), { 'stripe-signature': 't=abc,v1=00' }),
    ).toThrowError(InvalidWebhookSignatureError);
  });

  it('Stripe: accepta si cand antetul poarta mai multe semnaturi v1 (rotirea secretului)', () => {
    const body = JSON.stringify({
      id: 'evt',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    });
    const good = signStripeWebhook(WEBHOOK_SECRET, body, seconds);
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, () => START);

    expect(
      verifier.verify(Buffer.from(body), { 'stripe-signature': `${good},v1=${'0'.repeat(64)}` }),
    ).toMatchObject({ kind: 'CAPTURED' });
  });
});

describe('HandlePaymentWebhook (reconciliere)', () => {
  const setup = async () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger('debug', {}, (_level, line) => lines.push(line));
    const h = buildPaymentsHarness();
    const webhooks = new HandlePaymentWebhook(h.providers, h.payments, logger);
    const order = h.newOrder(1);
    const payment = await h.payOrder.execute(owner, order.id);
    const stripe = scenarios[0] as Scenario;
    const send = (payload: object) => {
      const { body, headers } = stripe.sign(payload);
      return webhooks.handle('STRIPE', body, headers);
    };
    return { h, payment, send, lines };
  };

  const event = (type: string, id: string) => ({
    id: `evt_${type}`,
    type,
    data: { object: { id, payment_intent: id } },
  });

  it('un eveniment pentru o plata cunoscuta se potriveste si intoarce starea ei', async () => {
    const { payment, send } = await setup();
    const outcome = await send(event('payment_intent.succeeded', payment.externalId ?? ''));
    expect(outcome).toEqual({ matched: true, paymentStatus: 'CAPTURED' });
  });

  it('livrarea repetata a aceluiasi eveniment da acelasi rezultat si nu schimba nimic (idempotent)', async () => {
    const { h, payment, send } = await setup();
    const first = await send(event('payment_intent.succeeded', payment.externalId ?? ''));
    const second = await send(event('payment_intent.succeeded', payment.externalId ?? ''));

    expect(second).toEqual(first);
    expect(await h.payments.findByOrderId(payment.orderId)).toEqual(payment);
  });

  it('un eveniment pentru o plata necunoscuta nu se potriveste si se logheaza', async () => {
    const { send, lines } = await setup();
    expect(await send(event('payment_intent.succeeded', 'pi_necunoscut'))).toEqual({
      matched: false,
      paymentStatus: null,
    });
    expect(lines.some((l) => l.includes('plata necunoscuta'))).toBe(true);
  });

  it('un eveniment ignorat nu cauta nimic', async () => {
    const { send } = await setup();
    expect(await send(event('customer.created', 'cus_1'))).toEqual({
      matched: false,
      paymentStatus: null,
    });
  });

  it('un eveniment in dezacord cu starea noastra se logheaza, dar NU modifica plata', async () => {
    const { h, payment, send, lines } = await setup();

    const outcome = await send(event('payment_intent.payment_failed', payment.externalId ?? ''));

    expect(outcome).toEqual({ matched: true, paymentStatus: 'CAPTURED' });
    expect(lines.some((l) => l.includes('dezacord'))).toBe(true);
    expect(await h.payments.findByOrderId(payment.orderId)).toEqual(payment);
  });

  it('semnatura gresita: nimic nu se proceseaza', async () => {
    const { h, payment } = await setup();
    const stripe = scenarios[0] as Scenario;
    const { body, headers } = stripe.sign(
      event('payment_intent.succeeded', payment.externalId ?? ''),
      'alt-secret-de-16-caractere',
    );

    await expect(h.webhooks.handle('STRIPE', body, headers)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  it('webhook-ul unui furnizor nu poate fi verificat cu verificatorul altuia', async () => {
    const { h, payment } = await setup();
    const stripe = scenarios[0] as Scenario;
    const { body, headers } = stripe.sign(
      event('payment_intent.succeeded', payment.externalId ?? ''),
    );

    await expect(h.webhooks.handle('PAYPAL', body, headers)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});
