import { describe, expect, it, vi } from 'vitest';
import { InMemoryPaymentRepository } from '../../../src/modules/payments/adapters/persistence/InMemoryPaymentRepository';
import {
  AbstractPaymentProcessor,
  type PaymentProcessorDependencies,
} from '../../../src/modules/payments/application/AbstractPaymentProcessor';
import {
  CashOnDeliveryPaymentProcessor,
  COD_MAX_AMOUNT_CENTS,
} from '../../../src/modules/payments/application/processors/CashOnDeliveryPaymentProcessor';
import {
  PAYPAL_MAX_AMOUNT_CENTS,
  PayPalPaymentProcessor,
} from '../../../src/modules/payments/application/processors/PayPalPaymentProcessor';
import {
  STRIPE_MAX_AMOUNT_CENTS,
  StripePaymentProcessor,
} from '../../../src/modules/payments/application/processors/StripePaymentProcessor';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentTimeoutError,
} from '../../../src/modules/payments/domain/errors';
import { Payment } from '../../../src/modules/payments/domain/Payment';
import type { PaymentProvider } from '../../../src/modules/payments/domain/PaymentTypes';
import type {
  AuthorizeRequest,
  CaptureRequest,
  PaymentGateway,
} from '../../../src/modules/payments/ports/out/PaymentGateway';
import { Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';
import { silentLogger } from '../../helpers/silent-logger';

const NOW = new Date('2026-06-01T10:00:00.000Z');

/** Gateway scriptat: inregistreaza apelurile si poate fi facut sa esueze la un pas. */
class ScriptedGateway implements PaymentGateway {
  readonly calls: string[] = [];
  readonly authorizeRequests: AuthorizeRequest[] = [];
  readonly captureRequests: CaptureRequest[] = [];
  failAuthorize: Error | null = null;
  failCapture: Error | null = null;

  authorize(request: AuthorizeRequest) {
    this.calls.push('gateway.authorize');
    this.authorizeRequests.push(request);
    if (this.failAuthorize) return Promise.reject(this.failAuthorize);
    return Promise.resolve({ externalId: 'auth-1' });
  }

  capture(request: CaptureRequest) {
    this.calls.push('gateway.capture');
    this.captureRequests.push(request);
    if (this.failCapture) return Promise.reject(this.failCapture);
    return Promise.resolve({ externalId: 'capture-1' });
  }

  refund() {
    this.calls.push('gateway.refund');
    return Promise.resolve({ externalId: 'refund-1' });
  }
}

/** Subclasa de test care dezvaluie ordinea pasilor sablonului. */
class TracingProcessor extends AbstractPaymentProcessor {
  readonly steps: string[] = [];

  protected validate(): void {
    this.steps.push('validate');
  }

  protected reference(payment: Payment): string {
    return `trace-${payment.orderId}`;
  }

  protected override async authorize(payment: Payment): Promise<Payment> {
    this.steps.push('authorize');
    return super.authorize(payment);
  }

  protected override async capture(payment: Payment): Promise<Payment> {
    this.steps.push('capture');
    return super.capture(payment);
  }

  protected override async record(payment: Payment): Promise<Payment> {
    this.steps.push('record');
    return super.record(payment);
  }
}

function setup(amount = 10_000, provider: PaymentProvider = 'STRIPE') {
  const gateway = new ScriptedGateway();
  const payments = new InMemoryPaymentRepository();
  const dependencies: PaymentProcessorDependencies = {
    gateway,
    payments,
    clock: () => NOW,
    logger: silentLogger,
  };
  const pending = Payment.start({
    id: uuid(1),
    orderId: uuid(2),
    provider,
    amount: Money.of(amount, 'RON'),
    now: NOW,
  });
  const claim = async (): Promise<Payment> => {
    await payments.insert(pending);
    return pending;
  };
  return { gateway, payments, dependencies, pending, claim };
}

describe('AbstractPaymentProcessor (Template Method)', () => {
  describe('scheletul process()', () => {
    it('ruleaza pasii in ordinea validate -> authorize -> capture -> record', async () => {
      const { dependencies, claim } = setup();
      const processor = new TracingProcessor(dependencies);

      await processor.process(await claim());

      expect(processor.steps).toEqual(['validate', 'authorize', 'capture', 'record']);
    });

    it('intoarce plata CAPTURED, cu id-ul capturii, si o salveaza', async () => {
      const { dependencies, payments, claim } = setup();

      const result = await new TracingProcessor(dependencies).process(await claim());

      expect(result).toMatchObject({ status: 'CAPTURED', externalId: 'capture-1' });
      expect(await payments.findByOrderId(uuid(2))).toEqual(result);
    });

    it('trimite gateway-ului suma, referinta si cheile de idempotenta (captarea are cheia ei)', async () => {
      const { gateway, dependencies, claim } = setup(4_200);

      await new TracingProcessor(dependencies).process(await claim());

      expect(gateway.authorizeRequests[0]).toMatchObject({
        paymentId: uuid(1),
        reference: `trace-${uuid(2)}`,
        idempotencyKey: `pay:${uuid(2)}`,
      });
      expect(gateway.authorizeRequests[0]?.amount.toJSON()).toEqual({
        amount: 4_200,
        currency: 'RON',
      });
      expect(gateway.captureRequests[0]).toMatchObject({
        externalId: 'auth-1',
        idempotencyKey: `pay:${uuid(2)}:capture`,
      });
    });

    it('subclasele concrete nu suprascriu metoda-sablon', () => {
      for (const processor of [
        StripePaymentProcessor,
        PayPalPaymentProcessor,
        CashOnDeliveryPaymentProcessor,
      ]) {
        expect(Object.hasOwn(processor.prototype, 'process')).toBe(false);
      }
    });
  });

  describe('esecuri: plata este salvata DECLINED / FAILED, iar eroarea originala ajunge la apelant', () => {
    it('validarea esuata: gateway-ul nu e apelat deloc; plata FAILED cu codul regulii', async () => {
      const { gateway, payments, dependencies, claim } = setup(STRIPE_MAX_AMOUNT_CENTS + 1);

      await expect(
        new StripePaymentProcessor(dependencies).process(await claim()),
      ).rejects.toMatchObject({ code: 'AMOUNT_ABOVE_PROVIDER_LIMIT' });

      expect(gateway.calls).toEqual([]);
      expect(await payments.findByOrderId(uuid(2))).toMatchObject({
        status: 'FAILED',
        failureReason: 'amount_above_provider_limit',
      });
    });

    it('card refuzat la autorizare: DECLINED cu motivul furnizorului; captarea nu se mai incearca', async () => {
      const { gateway, payments, dependencies, claim } = setup();
      gateway.failAuthorize = new PaymentDeclinedError('refuzat', 'card_declined');

      await expect(
        new TracingProcessor(dependencies).process(await claim()),
      ).rejects.toBeInstanceOf(PaymentDeclinedError);

      expect(gateway.calls).toEqual(['gateway.authorize']);
      expect(await payments.findByOrderId(uuid(2))).toMatchObject({
        status: 'DECLINED',
        failureReason: 'card_declined',
      });
    });

    it.each([
      ['timeout', () => new PaymentTimeoutError('timeout'), 'provider_timeout'],
      ['eroare de furnizor', () => new PaymentProviderError('500'), 'provider_error'],
      ['eroare neasteptata', () => new Error('boom'), 'unexpected_error'],
    ])('%s la autorizare: FAILED cu codul %s', async (_name, makeError, reason) => {
      const { gateway, payments, dependencies, claim } = setup();
      gateway.failAuthorize = makeError();

      await expect(new TracingProcessor(dependencies).process(await claim())).rejects.toThrow();

      expect(await payments.findByOrderId(uuid(2))).toMatchObject({
        status: 'FAILED',
        failureReason: reason,
        externalId: null,
      });
    });

    it('captare esuata dupa o autorizare reusita: FAILED, cu id-ul autorizarii pastrat pentru reconciliere', async () => {
      const { gateway, payments, dependencies, claim } = setup();
      gateway.failCapture = new PaymentTimeoutError('timeout');

      await expect(
        new TracingProcessor(dependencies).process(await claim()),
      ).rejects.toBeInstanceOf(PaymentTimeoutError);

      expect(await payments.findByOrderId(uuid(2))).toMatchObject({
        status: 'FAILED',
        failureReason: 'provider_timeout',
        externalId: 'auth-1',
      });
    });

    it('un refuz la captare (dupa autorizare) e FAILED, nu DECLINED: furnizorul tine deja o rezervare', async () => {
      const { gateway, payments, dependencies, claim } = setup();
      gateway.failCapture = new PaymentDeclinedError('refuzat', 'card_declined');

      await expect(
        new TracingProcessor(dependencies).process(await claim()),
      ).rejects.toBeInstanceOf(PaymentDeclinedError);

      expect(await payments.findByOrderId(uuid(2))).toMatchObject({
        status: 'FAILED',
        failureReason: 'card_declined',
        externalId: 'auth-1',
      });
    });

    it('daca nici esecul nu poate fi salvat, eroarea originala (nu cea a bazei) ajunge la apelant', async () => {
      const { gateway, payments, dependencies, claim } = setup();
      gateway.failAuthorize = new PaymentDeclinedError('refuzat', 'card_declined');
      const payment = await claim();
      vi.spyOn(payments, 'update').mockRejectedValue(new Error('baza indisponibila'));

      await expect(new TracingProcessor(dependencies).process(payment)).rejects.toBeInstanceOf(
        PaymentDeclinedError,
      );
    });

    it('incasata, dar inregistrarea esueaza: eroarea se propaga (suma ramane de reconciliat)', async () => {
      const { payments, dependencies, claim } = setup();
      const payment = await claim();
      vi.spyOn(payments, 'update').mockRejectedValue(new Error('baza indisponibila'));

      await expect(new TracingProcessor(dependencies).process(payment)).rejects.toThrow(
        'baza indisponibila',
      );
    });
  });

  describe('pasii specifici fiecarui furnizor', () => {
    const cases = [
      ['STRIPE', StripePaymentProcessor, STRIPE_MAX_AMOUNT_CENTS, 'order_'],
      ['PAYPAL', PayPalPaymentProcessor, PAYPAL_MAX_AMOUNT_CENTS, 'INV-'],
      ['COD', CashOnDeliveryPaymentProcessor, COD_MAX_AMOUNT_CENTS, 'COD-'],
    ] as const;

    it('limitele difera: Stripe > PayPal > ramburs', () => {
      expect(STRIPE_MAX_AMOUNT_CENTS).toBeGreaterThan(PAYPAL_MAX_AMOUNT_CENTS);
      expect(PAYPAL_MAX_AMOUNT_CENTS).toBeGreaterThan(COD_MAX_AMOUNT_CENTS);
    });

    it.each(cases)(
      '%s: suma exact la limita trece, cu un cent peste e refuzata',
      async (provider, Processor, max) => {
        const atLimit = setup(max, provider);
        await expect(
          new Processor(atLimit.dependencies).process(await atLimit.claim()),
        ).resolves.toMatchObject({
          status: 'CAPTURED',
        });

        const above = setup(max + 1, provider);
        await expect(
          new Processor(above.dependencies).process(await above.claim()),
        ).rejects.toMatchObject({
          code: 'AMOUNT_ABOVE_PROVIDER_LIMIT',
        });
      },
    );

    it.each(cases)(
      '%s: referinta trimisa la furnizor are prefixul "%s..."',
      async (provider, Processor, _max, prefix) => {
        const { gateway, dependencies, claim } = setup(1_000, provider);

        await new Processor(dependencies).process(await claim());

        expect(gateway.authorizeRequests[0]?.reference).toBe(`${prefix}${uuid(2)}`);
      },
    );
  });
});
