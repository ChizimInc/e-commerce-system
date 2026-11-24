import { describe, expect, it } from 'vitest';
import { StripeFactory } from '../../../src/modules/payments/adapters/providers/stripe/StripeFactory';
import { MOCK_AMOUNTS } from '../../../src/modules/payments/adapters/providers/mock-support';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentRejectedError,
  PaymentTimeoutError,
} from '../../../src/modules/payments/domain/errors';
import { StripeError } from '../../../src/modules/payments/adapters/providers/stripe/StripeMockApi';
import { Payment } from '../../../src/modules/payments/domain/Payment';
import type { PaymentGateway } from '../../../src/modules/payments/ports/out/PaymentGateway';
import { ConflictError, DomainError } from '../../../src/shared';
import {
  admin,
  buildPaymentsHarness,
  owner,
  START,
  stranger,
  WEBHOOK_SECRET,
} from '../../helpers/payments-harness';
import { uuid } from '../../helpers/ids';

/** Fabrica Stripe al carei gateway esueaza la `authorize` de `failures` ori (apoi merge normal): simuleaza un furnizor instabil. */
function flakyStripe(failures: number, error: () => Error) {
  let remaining = failures;
  return (api: ConstructorParameters<typeof StripeFactory>[0], clock: () => Date) =>
    new (class extends StripeFactory {
      override createGateway(): PaymentGateway {
        const real = super.createGateway();
        return {
          authorize: (request) => {
            if (remaining > 0) {
              remaining -= 1;
              return Promise.reject(error());
            }
            return real.authorize(request);
          },
          capture: (request) => real.capture(request),
          refund: (request) => real.refund(request),
        };
      }
    })(api, WEBHOOK_SECRET, clock);
}

describe('PayOrder', () => {
  describe('plata reusita', () => {
    it('incaseaza prin furnizorul metodei de plata, salveaza plata CAPTURED si trece comanda in PAID', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 25_050);

      const payment = await h.payOrder.execute(owner, order.id);

      expect(payment).toMatchObject({
        status: 'CAPTURED',
        provider: 'STRIPE',
        orderId: order.id,
        idempotencyKey: `pay:${order.id}`,
      });
      expect(payment.amount.toJSON()).toEqual({ amount: 25_050, currency: 'RON' });
      expect(payment.externalId).toMatch(/^pi_mock_/);
      expect(await h.payments.findByOrderId(order.id)).toEqual(payment);
      expect(h.orders.paid).toEqual([order.id]);
      expect(h.stripe.capturedIntents()).toHaveLength(1);
    });

    it.each([
      ['CARD', 'STRIPE'],
      ['PAYPAL', 'PAYPAL'],
      ['CASH_ON_DELIVERY', 'COD'],
    ] as const)('metoda %s se plateste prin furnizorul %s', async (method, provider) => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 5_000, method);

      const payment = await h.payOrder.execute(owner, order.id);

      expect(payment).toMatchObject({ provider, status: 'CAPTURED' });
      expect(
        {
          STRIPE: h.stripe.capturedIntents().length,
          PAYPAL: h.paypal.completedCaptures().length,
          COD: h.courier.collectedTickets().length,
        }[provider],
      ).toBe(1);
    });
  });

  describe('cine are voie', () => {
    it('o comanda inexistenta este 404', async () => {
      const h = buildPaymentsHarness();
      await expect(h.payOrder.execute(owner, uuid(404))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('comanda altcuiva este 404 (nu se confirma ca exista) si nu se incaseaza nimic', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);

      await expect(h.payOrder.execute(stranger, order.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(h.stripe.capturedIntents()).toHaveLength(0);
      expect(await h.payments.findByOrderId(order.id)).toBeNull();
    });

    it('nici ADMIN nu plateste in locul proprietarului', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);

      await expect(h.payOrder.execute(admin, order.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(h.stripe.capturedIntents()).toHaveLength(0);
    });
  });

  describe('starea comenzii', () => {
    it('o comanda deja platita (PAID) da 409 ORDER_ALREADY_PAID, fara apel la furnizor', async () => {
      const h = buildPaymentsHarness();
      const order = h.orders.add(uuid(1), { state: 'PAID' });

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });
      expect(h.stripe.capturedIntents()).toHaveLength(0);
    });

    it('o comanda anulata inainte de plata da 409 ORDER_NOT_PAYABLE', async () => {
      const h = buildPaymentsHarness();
      const order = h.orders.add(uuid(1), { state: 'CLOSED' });

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_NOT_PAYABLE',
      });
    });
  });

  describe('dubla plata', () => {
    it('a doua cerere (dupa prima) da 409 si nu incaseaza a doua oara', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      await h.payOrder.execute(owner, order.id);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });

      expect(h.stripe.capturedIntents()).toHaveLength(1);
      expect(h.orders.paid).toEqual([order.id]);
    });

    it('o cerere cu citire invechita (comanda pare inca NEW) reia decontarea, o gaseste facuta si da 409, fara a incasa din nou', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      await h.payOrder.execute(owner, order.id);
      h.orders.staleStateOnce = 'AWAITING_PAYMENT';

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });

      expect(h.stripe.capturedIntents()).toHaveLength(1);
      expect(h.stripe.issuedRefunds()).toHaveLength(0); // plata decontata de prima cerere nu se ramburseaza
      expect((await h.payments.findByOrderId(order.id))?.status).toBe('CAPTURED');
    });

    it('cereri concurente pentru aceeasi comanda: exact una reuseste, restul primesc 409, o singura incasare', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => h.payOrder.execute(owner, order.id)),
      );

      const ok = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const { reason } of rejected) {
        expect(reason).toBeInstanceOf(ConflictError);
        expect(['PAYMENT_IN_PROGRESS', 'ORDER_ALREADY_PAID']).toContain(
          (reason as DomainError).code,
        );
      }
      expect(h.stripe.capturedIntents()).toHaveLength(1);
      expect(h.orders.paid).toEqual([order.id]);
    });

    it('o plata PENDING a aceleiasi comenzi (alta cerere o proceseaza) da 409 PAYMENT_IN_PROGRESS', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      await h.payments.insert(
        Payment.start({
          id: uuid(9),
          orderId: order.id,
          provider: 'STRIPE',
          amount: order.total,
          now: START,
        }),
      );

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'PAYMENT_IN_PROGRESS',
      });
      expect(h.stripe.capturedIntents()).toHaveLength(0);
    });

    it('cereri concurente de reluare a unei plati esuate: o singura reluare, o singura incasare', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      const failed = Payment.start({
        id: uuid(9),
        orderId: order.id,
        provider: 'STRIPE',
        amount: order.total,
        now: START,
      }).failed('provider_error', START);
      await h.payments.insert(failed);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => h.payOrder.execute(owner, order.id)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(h.stripe.capturedIntents()).toHaveLength(1);
    });
  });

  describe('refuz, esec si reluare', () => {
    it('card refuzat: 422 PAYMENT_DECLINED, plata DECLINED cu motivul, comanda ramane NEW', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, MOCK_AMOUNTS.DECLINE);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(
        PaymentDeclinedError,
      );

      expect(await h.payments.findByOrderId(order.id)).toMatchObject({
        status: 'DECLINED',
        failureReason: 'card_declined',
      });
      expect(h.orders.paid).toEqual([]);
      expect(h.stripe.capturedIntents()).toHaveLength(0);
    });

    it.each(['CARD', 'PAYPAL', 'CASH_ON_DELIVERY'] as const)(
      '%s: refuz, eroare de furnizor si timeout au fiecare rezultatul lor, fara sa plateasca comanda',
      async (method) => {
        const h = buildPaymentsHarness();
        const cases = [
          [MOCK_AMOUNTS.DECLINE, PaymentDeclinedError, 'DECLINED'],
          [MOCK_AMOUNTS.PROVIDER_ERROR, PaymentProviderError, 'FAILED'],
          [MOCK_AMOUNTS.TIMEOUT, PaymentTimeoutError, 'FAILED'],
        ] as const;
        let n = 1;
        for (const [amount, ErrorClass, status] of cases) {
          const order = h.newOrder(n++, amount, method);

          await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(ErrorClass);

          expect((await h.payments.findByOrderId(order.id))?.status).toBe(status);
        }
        expect(h.orders.paid).toEqual([]);
      },
    );

    it('suma peste limita furnizorului: 422, plata FAILED, furnizorul nu e apelat', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 500_001, 'CASH_ON_DELIVERY'); // plafon ramburs 5.000,00

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(
        PaymentRejectedError,
      );

      expect(await h.payments.findByOrderId(order.id)).toMatchObject({
        status: 'FAILED',
        failureReason: 'amount_above_provider_limit',
      });
      expect(h.courier.collectedTickets()).toHaveLength(0);
    });

    it('dupa un timeout, clientul poate relua: aceeasi plata (acelasi id), acum CAPTURED', async () => {
      const h = buildPaymentsHarness({
        stripeFactory: flakyStripe(1, () => new PaymentTimeoutError('timeout')),
      });
      const order = h.newOrder(1);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(PaymentTimeoutError);
      const failed = await h.payments.findByOrderId(order.id);
      expect(failed?.status).toBe('FAILED');

      const retried = await h.payOrder.execute(owner, order.id);

      expect(retried).toMatchObject({ status: 'CAPTURED', id: failed?.id, failureReason: null });
      expect(h.stripe.capturedIntents()).toHaveLength(1);
      expect(h.orders.paid).toEqual([order.id]);
    });

    it('dupa un card refuzat se poate relua; dupa incasare nu mai', async () => {
      const h = buildPaymentsHarness({
        stripeFactory: flakyStripe(1, () => new PaymentDeclinedError('refuzat', 'card_declined')),
      });
      const order = h.newOrder(1);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(
        PaymentDeclinedError,
      );
      await expect(h.payOrder.execute(owner, order.id)).resolves.toMatchObject({
        status: 'CAPTURED',
      });
      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });
    });
  });

  describe('decontarea comenzii dupa incasare', () => {
    /** Simuleaza o anulare care se intampla chiar inainte ca plata sa treaca comanda in PAID. */
    const cancelDuringPayment = (h: ReturnType<typeof buildPaymentsHarness>, orderId: string) => {
      h.orders.beforeMarkPaid = () => h.orders.setState(orderId, 'CLOSED');
    };

    it('comanda anulata in timpul platii: suma incasata se returneaza imediat, plata devine REFUNDED, eroarea ajunge la client', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 7_000);
      cancelDuringPayment(h, order.id);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });

      expect(await h.payments.findByOrderId(order.id)).toMatchObject({ status: 'REFUNDED' });
      expect(h.stripe.capturedIntents()).toHaveLength(1);
      expect(h.stripe.issuedRefunds()).toHaveLength(1);
      expect(h.stripe.issuedRefunds()[0]?.amount).toBe(7_000);
      expect(h.orders.paid).toEqual([]);
    });

    it('daca nici rambursarea compensatorie nu reuseste, plata ramane CAPTURED (de reconciliat) si eroarea comenzii ajunge la client', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, MOCK_AMOUNTS.REFUND_FAILURE);
      cancelDuringPayment(h, order.id);

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });

      expect((await h.payments.findByOrderId(order.id))?.status).toBe('CAPTURED');
    });

    it('esec TRANZITORIU la decontare (comanda ramane NEW): plata ramane CAPTURED si nu se ramburseaza', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      h.orders.markPaidError = new DomainError('baza indisponibila', 'DB_DOWN');

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({ code: 'DB_DOWN' });

      expect((await h.payments.findByOrderId(order.id))?.status).toBe('CAPTURED');
      expect(h.stripe.issuedRefunds()).toHaveLength(0);
    });

    it('reluarea dupa un esec tranzitoriu duce la capat doar decontarea: comanda devine PAID, o singura incasare', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      h.orders.markPaidError = new DomainError('baza indisponibila', 'DB_DOWN');
      await expect(h.payOrder.execute(owner, order.id)).rejects.toThrow();
      h.orders.markPaidError = null;

      const resumed = await h.payOrder.execute(owner, order.id);

      expect(resumed).toMatchObject({ status: 'CAPTURED', orderId: order.id });
      expect(h.orders.paid).toEqual([order.id]);
      expect(h.stripe.capturedIntents()).toHaveLength(1);
      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });
    });

    it('decontarea a reusit, dar raspunsul s-a pierdut (eroare, desi comanda e PAID): nu se ramburseaza, cererea reuseste', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      h.orders.beforeMarkPaid = () => {
        h.orders.setState(order.id, 'PAID');
        h.orders.markPaidError = new DomainError('conexiune pierduta', 'DB_DOWN');
      };

      const payment = await h.payOrder.execute(owner, order.id);

      expect(payment.status).toBe('CAPTURED');
      expect(h.stripe.issuedRefunds()).toHaveLength(0);
    });

    it('o plata REFUNDED nu se mai reia, chiar daca comanda ar parea iar platibila', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 7_000);
      cancelDuringPayment(h, order.id);
      await expect(h.payOrder.execute(owner, order.id)).rejects.toThrow();
      h.orders.setState(order.id, 'AWAITING_PAYMENT');

      await expect(h.payOrder.execute(owner, order.id)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
      });
      expect(h.stripe.capturedIntents()).toHaveLength(1);
    });
  });

  describe('captare esuata dupa o autorizare reusita', () => {
    it('timeout la captare: plata FAILED cu id-ul rezervarii; reluarea (aceleasi chei) o duce la capat', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1);
      const realCapture = h.stripe.paymentIntents.capture;
      let failOnce = true;
      h.stripe.paymentIntents.capture = (...args) => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new StripeError('connection lost', 'api_connection_error'));
        }
        return realCapture(...args);
      };

      await expect(h.payOrder.execute(owner, order.id)).rejects.toBeInstanceOf(PaymentTimeoutError);
      const failed = await h.payments.findByOrderId(order.id);
      expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'provider_timeout' });
      expect(failed?.externalId).toMatch(/^pi_mock_/);

      const retried = await h.payOrder.execute(owner, order.id);

      expect(retried.status).toBe('CAPTURED');
      expect(h.stripe.capturedIntents()).toHaveLength(1);
      // aceeasi cheie de idempotenta la autorizare => furnizorul nu a creat o a doua rezervare
      expect(h.stripe.capturedIntents()[0]?.id).toBe(failed?.externalId);
    });
  });
});

describe('GetOrderPayment', () => {
  it('proprietarul si ADMIN vad plata; altcineva primeste 404', async () => {
    const h = buildPaymentsHarness();
    const order = h.newOrder(1);
    const payment = await h.payOrder.execute(owner, order.id);

    expect(await h.getOrderPayment.execute(owner, order.id)).toEqual(payment);
    expect(await h.getOrderPayment.execute(admin, order.id)).toEqual(payment);
    await expect(h.getOrderPayment.execute(stranger, order.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('o comanda fara plata (sau inexistenta) este 404', async () => {
    const h = buildPaymentsHarness();
    const order = h.newOrder(1);

    await expect(h.getOrderPayment.execute(owner, order.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.getOrderPayment.execute(owner, uuid(404))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
