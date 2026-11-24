import { CashOnDeliveryFactory } from '../../src/modules/payments/adapters/providers/cod/CashOnDeliveryFactory';
import { CourierCodApi } from '../../src/modules/payments/adapters/providers/cod/CourierCodApi';
import { PayPalFactory } from '../../src/modules/payments/adapters/providers/paypal/PayPalFactory';
import { PayPalMockClient } from '../../src/modules/payments/adapters/providers/paypal/PayPalMockClient';
import { StripeFactory } from '../../src/modules/payments/adapters/providers/stripe/StripeFactory';
import { StripeMockApi } from '../../src/modules/payments/adapters/providers/stripe/StripeMockApi';
import { InMemoryPaymentRepository } from '../../src/modules/payments/adapters/persistence/InMemoryPaymentRepository';
import { GetOrderPayment } from '../../src/modules/payments/application/GetOrderPayment';
import { HandlePaymentWebhook } from '../../src/modules/payments/application/HandlePaymentWebhook';
import { PayOrder } from '../../src/modules/payments/application/PayOrder';
import { PaymentProviders } from '../../src/modules/payments/application/PaymentProviders';
import { RefundOnOrderCancelled } from '../../src/modules/payments/application/RefundOnOrderCancelled';
import { RefundPayment } from '../../src/modules/payments/application/RefundPayment';
import type { PaymentMethod } from '../../src/modules/payments/domain/PaymentTypes';
import type {
  PayableOrder,
  PayableOrders,
} from '../../src/modules/payments/ports/out/PayableOrders';
import type { PaymentProviderFactory } from '../../src/modules/payments/ports/out/PaymentProviderFactory';
import { DomainError, InMemoryEventBus, Money, type Principal } from '../../src/shared';
import { SequentialIdGenerator, uuid } from './ids';
import { silentLogger } from './silent-logger';

export const WEBHOOK_SECRET = 'webhook-secret-for-tests-123';
export const START = new Date('2026-06-01T10:00:00.000Z');

export const owner: Principal = { userId: uuid(901), role: 'CUSTOMER' };
export const stranger: Principal = { userId: uuid(902), role: 'CUSTOMER' };
export const admin: Principal = { userId: uuid(990), role: 'ADMIN' };

/** Comenzile vazute de `payments`, tinute in memorie; `markPaid` poate fi facut sa esueze (ex. comanda anulata intre timp). */
export class FakePayableOrders implements PayableOrders {
  readonly orders = new Map<string, PayableOrder>();
  readonly paid: string[] = [];
  readonly refunded: string[] = [];
  markPaidError: Error | null = null;
  markRefundedError: Error | null = null;
  /** Apelat in `markPaid`, inainte de efect: permite unui test sa simuleze o anulare concurenta. */
  beforeMarkPaid: (() => void) | null = null;
  /** Urmatoarea citire (`find`) intoarce aceasta stare, desi comanda e in alta (citire invechita). */
  staleStateOnce: PayableOrder['state'] | null = null;

  add(
    id: string,
    overrides: Partial<Omit<PayableOrder, 'id'>> & { amount?: number } = {},
  ): PayableOrder {
    const { amount, ...rest } = overrides;
    const order: PayableOrder = {
      id,
      customerId: owner.userId,
      total: Money.of(amount ?? 10_000, 'RON'),
      paymentMethod: 'CARD',
      state: 'AWAITING_PAYMENT',
      ...rest,
    };
    this.orders.set(id, order);
    return order;
  }

  find(orderId: string): Promise<PayableOrder | null> {
    const order = this.orders.get(orderId) ?? null;
    if (order && this.staleStateOnce) {
      const stale = { ...order, state: this.staleStateOnce };
      this.staleStateOnce = null;
      return Promise.resolve(stale);
    }
    return Promise.resolve(order);
  }

  /** Muta comanda intr-o alta stare (ex. anulata de ADMIN). */
  setState(orderId: string, state: PayableOrder['state']): void {
    const order = this.orders.get(orderId);
    if (order) this.orders.set(orderId, { ...order, state });
  }

  markPaid(orderId: string): Promise<void> {
    this.beforeMarkPaid?.();
    if (this.markPaidError) return Promise.reject(this.markPaidError);
    const order = this.orders.get(orderId);
    // Ca in ordering: doar o comanda NEW se poate plati.
    if (order && order.state !== 'AWAITING_PAYMENT') {
      return Promise.reject(
        new DomainError('Tranzitie invalida a comenzii: -> PAID', 'INVALID_ORDER_TRANSITION'),
      );
    }
    if (order) this.orders.set(orderId, { ...order, state: 'PAID' });
    this.paid.push(orderId);
    return Promise.resolve();
  }

  markRefunded(orderId: string): Promise<void> {
    if (this.markRefundedError) return Promise.reject(this.markRefundedError);
    this.refunded.push(orderId);
    return Promise.resolve();
  }
}

/** Modulul `payments` asamblat pe adaptoare in-memory si pe cele trei mock-uri de furnizori, cu un ceas controlabil. */
export interface PaymentsHarnessOptions {
  /** Inlocuieste fabrica Stripe (ex. cu una al carei gateway esueaza la comanda). */
  stripeFactory?: (api: StripeMockApi, clock: () => Date) => PaymentProviderFactory;
}

export function buildPaymentsHarness(options: PaymentsHarnessOptions = {}) {
  let now = START;
  const clock = () => new Date(now);
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  const stripe = new StripeMockApi();
  const paypal = new PayPalMockClient();
  const courier = new CourierCodApi();
  const factories = [
    options.stripeFactory?.(stripe, clock) ?? new StripeFactory(stripe, WEBHOOK_SECRET, clock),
    new PayPalFactory(paypal, WEBHOOK_SECRET, clock),
    new CashOnDeliveryFactory(courier, WEBHOOK_SECRET),
  ];

  const orders = new FakePayableOrders();
  const payments = new InMemoryPaymentRepository();
  const providers = new PaymentProviders(factories, { payments, clock, logger: silentLogger });
  const refunds = new RefundPayment(payments, providers, clock, silentLogger);
  const events = new InMemoryEventBus(silentLogger);
  const refundOnCancelled = new RefundOnOrderCancelled(orders, payments, refunds, silentLogger);
  refundOnCancelled.register(events);

  const payOrder = new PayOrder(
    orders,
    payments,
    providers,
    refunds,
    new SequentialIdGenerator(7000),
    clock,
    silentLogger,
  );

  /** O comanda de `amount` cenți, cu metoda de plata data, gata de platit. */
  const newOrder = (
    n: number,
    amount = 10_000,
    paymentMethod: PaymentMethod = 'CARD',
  ): PayableOrder => orders.add(uuid(n), { amount, paymentMethod });

  return {
    clock,
    advance,
    stripe,
    paypal,
    courier,
    factories,
    orders,
    payments,
    providers,
    refunds,
    events,
    refundOnCancelled,
    payOrder,
    getOrderPayment: new GetOrderPayment(orders, payments),
    webhooks: new HandlePaymentWebhook(providers, payments, silentLogger),
    newOrder,
  };
}

export type PaymentsHarness = ReturnType<typeof buildPaymentsHarness>;
