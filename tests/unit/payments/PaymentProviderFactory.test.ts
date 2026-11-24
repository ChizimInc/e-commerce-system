import { describe, expect, it } from 'vitest';
import { CashOnDeliveryFactory } from '../../../src/modules/payments/adapters/providers/cod/CashOnDeliveryFactory';
import { CashOnDeliveryGateway } from '../../../src/modules/payments/adapters/providers/cod/CashOnDeliveryGateway';
import { CashOnDeliveryWebhookVerifier } from '../../../src/modules/payments/adapters/providers/cod/CashOnDeliveryWebhookVerifier';
import { CourierCodApi } from '../../../src/modules/payments/adapters/providers/cod/CourierCodApi';
import { PayPalFactory } from '../../../src/modules/payments/adapters/providers/paypal/PayPalFactory';
import { PayPalGateway } from '../../../src/modules/payments/adapters/providers/paypal/PayPalGateway';
import { PayPalMockClient } from '../../../src/modules/payments/adapters/providers/paypal/PayPalMockClient';
import { PayPalRefundProcessor } from '../../../src/modules/payments/adapters/providers/paypal/PayPalRefundProcessor';
import { PayPalWebhookVerifier } from '../../../src/modules/payments/adapters/providers/paypal/PayPalWebhookVerifier';
import { StripeFactory } from '../../../src/modules/payments/adapters/providers/stripe/StripeFactory';
import { StripeGateway } from '../../../src/modules/payments/adapters/providers/stripe/StripeGateway';
import { StripeMockApi } from '../../../src/modules/payments/adapters/providers/stripe/StripeMockApi';
import { StripeWebhookVerifier } from '../../../src/modules/payments/adapters/providers/stripe/StripeWebhookVerifier';
import { GatewayRefundProcessor } from '../../../src/modules/payments/application/GatewayRefundProcessor';
import { PaymentProviders } from '../../../src/modules/payments/application/PaymentProviders';
import { CashOnDeliveryPaymentProcessor } from '../../../src/modules/payments/application/processors/CashOnDeliveryPaymentProcessor';
import { PayPalPaymentProcessor } from '../../../src/modules/payments/application/processors/PayPalPaymentProcessor';
import { StripePaymentProcessor } from '../../../src/modules/payments/application/processors/StripePaymentProcessor';
import { PaymentProviderError } from '../../../src/modules/payments/domain/errors';
import { Payment } from '../../../src/modules/payments/domain/Payment';
import type { PaymentProviderFactory } from '../../../src/modules/payments/ports/out/PaymentProviderFactory';
import { InMemoryPaymentRepository } from '../../../src/modules/payments/adapters/persistence/InMemoryPaymentRepository';
import { Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';
import { silentLogger } from '../../helpers/silent-logger';
import { START, WEBHOOK_SECRET } from '../../helpers/payments-harness';

const clock = () => START;
const ron = (cents: number) => Money.of(cents, 'RON');

describe('PaymentProviderFactory (Abstract Factory)', () => {
  const stripeApi = new StripeMockApi();
  const paypalClient = new PayPalMockClient();
  const courierApi = new CourierCodApi();
  const stripe = new StripeFactory(stripeApi, WEBHOOK_SECRET, clock);
  const paypal = new PayPalFactory(paypalClient, WEBHOOK_SECRET, clock);
  const cod = new CashOnDeliveryFactory(courierApi, WEBHOOK_SECRET);

  it('fiecare fabrica concreta deserveste un furnizor si o metoda de plata', () => {
    expect([stripe, paypal, cod].map((f) => [f.provider, f.method])).toEqual([
      ['STRIPE', 'CARD'],
      ['PAYPAL', 'PAYPAL'],
      ['COD', 'CASH_ON_DELIVERY'],
    ]);
  });

  describe('familia creata e consecventa: toate produsele sunt ale aceluiasi furnizor', () => {
    it('Stripe', () => {
      expect(stripe.createGateway()).toBeInstanceOf(StripeGateway);
      expect(stripe.createRefundProcessor()).toBeInstanceOf(GatewayRefundProcessor);
      expect(stripe.createWebhookVerifier()).toBeInstanceOf(StripeWebhookVerifier);
    });

    it('PayPal (cu procesorul lui de rambursari, cu fereastra de 180 de zile)', () => {
      expect(paypal.createGateway()).toBeInstanceOf(PayPalGateway);
      expect(paypal.createRefundProcessor()).toBeInstanceOf(PayPalRefundProcessor);
      expect(paypal.createWebhookVerifier()).toBeInstanceOf(PayPalWebhookVerifier);
    });

    it('ramburs', () => {
      expect(cod.createGateway()).toBeInstanceOf(CashOnDeliveryGateway);
      expect(cod.createRefundProcessor()).toBeInstanceOf(GatewayRefundProcessor);
      expect(cod.createWebhookVerifier()).toBeInstanceOf(CashOnDeliveryWebhookVerifier);
    });
  });

  describe('produsele aceleiasi familii lucreaza impreuna; cele din familii diferite nu', () => {
    const refunding = (provider: 'STRIPE' | 'PAYPAL' | 'COD', externalId: string, id = uuid(1)) =>
      Payment.start({ id, orderId: uuid(2), provider, amount: ron(5_000), now: START })
        .authorized(externalId, START)
        .captured(externalId, START)
        .startRefund(START);

    it.each([
      ['Stripe', stripe],
      ['PayPal', paypal],
      ['ramburs', cod],
    ] as const)(
      '%s: gateway-ul incaseaza, iar procesorul de rambursari al aceleiasi familii ramburseaza',
      async (_name, factory) => {
        const gateway = factory.createGateway();
        const authorization = await gateway.authorize({
          paymentId: uuid(1),
          reference: 'R',
          amount: ron(5_000),
          idempotencyKey: `k-${factory.provider}`,
        });
        const capture = await gateway.capture({
          externalId: authorization.externalId,
          amount: ron(5_000),
          idempotencyKey: `c-${factory.provider}`,
        });

        const refund = await factory
          .createRefundProcessor()
          .refund(refunding(factory.provider, capture.externalId));

        expect(refund.externalId).not.toBe('');
      },
    );

    it('o plata Stripe nu poate fi rambursata prin familia PayPal (id necunoscut acolo)', async () => {
      const authorization = await stripe.createGateway().authorize({
        paymentId: uuid(3),
        reference: 'R',
        amount: ron(100),
        idempotencyKey: 'cross',
      });
      await stripe.createGateway().capture({
        externalId: authorization.externalId,
        amount: ron(100),
        idempotencyKey: 'cross-c',
      });

      await expect(
        paypal
          .createRefundProcessor()
          .refund(refunding('PAYPAL', authorization.externalId, uuid(3))),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });
  });

  describe('PaymentProviders (clientul fabricilor)', () => {
    const build = (factories: readonly PaymentProviderFactory[]) =>
      new PaymentProviders(factories, {
        payments: new InMemoryPaymentRepository(),
        clock,
        logger: silentLogger,
      });

    it('alege furnizorul dupa metoda de plata, cu procesorul (Template Method) potrivit', () => {
      const providers = build([stripe, paypal, cod]);

      expect(providers.forMethod('CARD')).toMatchObject({ provider: 'STRIPE' });
      expect(providers.forMethod('CARD').processor).toBeInstanceOf(StripePaymentProcessor);
      expect(providers.forMethod('PAYPAL').processor).toBeInstanceOf(PayPalPaymentProcessor);
      expect(providers.forMethod('CASH_ON_DELIVERY').processor).toBeInstanceOf(
        CashOnDeliveryPaymentProcessor,
      );
    });

    it('gateway-ul, rambursarile si verificatorul unui furnizor vin din aceeasi fabrica', () => {
      const services = build([stripe, paypal, cod]).forProvider('PAYPAL');

      expect(services.gateway).toBeInstanceOf(PayPalGateway);
      expect(services.refunds).toBeInstanceOf(PayPalRefundProcessor);
      expect(services.webhooks).toBeInstanceOf(PayPalWebhookVerifier);
    });

    it('familia unui furnizor se construieste o singura data (aceleasi instante la fiecare cerere)', () => {
      const providers = build([stripe, paypal, cod]);
      expect(providers.forMethod('CARD')).toBe(providers.forMethod('CARD'));
      expect(providers.forProvider('STRIPE')).toBe(providers.forMethod('CARD'));
    });

    it('o metoda fara fabrica inregistrata e refuzata cu un cod clar', () => {
      const providers = build([stripe]);
      expect(() => providers.forMethod('PAYPAL')).toThrowError(
        expect.objectContaining({ code: 'PAYMENT_METHOD_UNSUPPORTED' }) as Error,
      );
      expect(() => providers.forProvider('COD')).toThrowError(
        expect.objectContaining({ code: 'PAYMENT_PROVIDER_UNSUPPORTED' }) as Error,
      );
    });

    it('doua fabrici pentru acelasi furnizor sunt o eroare de configurare', () => {
      expect(() =>
        build([stripe, new StripeFactory(new StripeMockApi(), 'x'.repeat(16), clock)]),
      ).toThrowError(/de doua ori/);
    });
  });
});
