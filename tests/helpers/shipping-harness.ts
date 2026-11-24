import { InMemoryShipmentRepository } from '../../src/modules/shipping/adapters/persistence/InMemoryShipmentRepository';
import { CourierDirectory } from '../../src/modules/shipping/application/CourierDirectory';
import { GetOrderShipment } from '../../src/modules/shipping/application/GetOrderShipment';
import { QuoteCartShipping } from '../../src/modules/shipping/application/QuoteCartShipping';
import { ShipOrder } from '../../src/modules/shipping/application/ShipOrder';
import { ShippingCostService } from '../../src/modules/shipping/application/ShippingCostService';
import {
  STANDARD_SHIPPING_RATES,
  ShippingCostStrategies,
} from '../../src/modules/shipping/domain/ShippingCostStrategy';
import type { CourierCode } from '../../src/modules/shipping/domain/ShippingTypes';
import type {
  CourierService,
  CourierShipment,
  CourierTracking,
  CreateCourierShipmentRequest,
} from '../../src/modules/shipping/ports/out/CourierService';
import type {
  ShippableOrder,
  ShippableOrders,
} from '../../src/modules/shipping/ports/out/ShippableOrders';
import type {
  CartQuoteBasis,
  QuotableCart,
} from '../../src/modules/shipping/ports/out/QuotableCart';
import { DomainError, Money, type Principal } from '../../src/shared';
import { SequentialIdGenerator, uuid } from './ids';
import { silentLogger } from './silent-logger';

export const START = new Date('2026-06-01T10:00:00.000Z');

export const owner: Principal = { userId: uuid(901), role: 'CUSTOMER' };
export const stranger: Principal = { userId: uuid(902), role: 'CUSTOMER' };
export const admin: Principal = { userId: uuid(990), role: 'ADMIN' };

/** Comenzile vazute de `shipping`, tinute in memorie; `markShipped` poate fi facut sa esueze (ex. comanda anulata intre timp). */
export class FakeShippableOrders implements ShippableOrders {
  readonly orders = new Map<string, ShippableOrder>();
  readonly shipped: string[] = [];
  markShippedError: Error | null = null;

  add(id: string, overrides: Partial<Omit<ShippableOrder, 'id'>> = {}): ShippableOrder {
    const order: ShippableOrder = {
      id,
      customerId: owner.userId,
      state: 'AWAITING_SHIPMENT',
      deliveryMethod: 'EXPRESS',
      recipient: {
        name: 'Ana Popescu',
        street: 'Str. Libertatii 10',
        city: 'Chisinau',
        postalCode: 'MD-2001',
        country: 'MD',
      },
      units: 2,
      total: Money.of(10_000, 'RON'),
      shippingCost: Money.of(3_200, 'RON'),
      ...overrides,
    };
    this.orders.set(id, order);
    return order;
  }

  find(orderId: string): Promise<ShippableOrder | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }

  setState(orderId: string, state: ShippableOrder['state']): void {
    const order = this.orders.get(orderId);
    if (order) this.orders.set(orderId, { ...order, state });
  }

  markShipped(orderId: string): Promise<void> {
    if (this.markShippedError) return Promise.reject(this.markShippedError);
    const order = this.orders.get(orderId);
    // Ca in ordering: doar o comanda PAID se poate expedia.
    if (order && order.state !== 'AWAITING_SHIPMENT') {
      return Promise.reject(
        new DomainError('Tranzitie invalida a comenzii: -> SHIPPED', 'INVALID_ORDER_TRANSITION'),
      );
    }
    if (order) this.orders.set(orderId, { ...order, state: 'SHIPPED' });
    this.shipped.push(orderId);
    return Promise.resolve();
  }
}

/** Un curier controlabil: inregistreaza apelurile si poate fi facut sa esueze sau sa raporteze o anumita stare. */
export class FakeCourier implements CourierService {
  readonly created: CreateCourierShipmentRequest[] = [];
  readonly tracked: string[] = [];
  createError: Error | null = null;
  trackError: Error | null = null;
  trackStatus: CourierTracking['status'] = 'CREATED';

  constructor(private readonly prefix: string) {}

  createShipment(request: CreateCourierShipmentRequest): Promise<CourierShipment> {
    if (this.createError) return Promise.reject(this.createError);
    this.created.push(request);
    const n = this.created.length;
    return Promise.resolve({
      externalId: `${this.prefix}-${n}`,
      trackingNumber: `TRK-${this.prefix}-${n}`,
    });
  }

  track(externalId: string): Promise<CourierTracking> {
    this.tracked.push(externalId);
    if (this.trackError) return Promise.reject(this.trackError);
    return Promise.resolve({ status: this.trackStatus });
  }
}

export class FakeCart implements QuotableCart {
  basis: CartQuoteBasis = { itemsValue: Money.of(10_000, 'RON'), units: 2 };

  basisOf(): Promise<CartQuoteBasis> {
    return Promise.resolve(this.basis);
  }
}

/** Modulul `shipping` asamblat pe adaptoare in-memory si pe curieri controlabili, cu un ceas controlabil. */
export function buildShippingHarness() {
  let now = START;
  const clock = () => new Date(now);
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  const orders = new FakeShippableOrders();
  const shipments = new InMemoryShipmentRepository();
  const services: Record<CourierCode, FakeCourier> = {
    FAST_COURIER: new FakeCourier('FC'),
    POST_OFFICE: new FakeCourier('PO'),
    STORE_PICKUP: new FakeCourier('SP'),
  };
  const directory = new CourierDirectory(services, {
    STANDARD: 'POST_OFFICE',
    EXPRESS: 'FAST_COURIER',
    STORE_PICKUP: 'STORE_PICKUP',
  });
  const cart = new FakeCart();
  const costs = new ShippingCostService(ShippingCostStrategies.fromRates(STANDARD_SHIPPING_RATES));

  return {
    clock,
    advance,
    orders,
    shipments,
    services,
    directory,
    cart,
    costs,
    shipOrder: new ShipOrder(
      orders,
      shipments,
      directory,
      new SequentialIdGenerator(8000),
      clock,
      silentLogger,
    ),
    getOrderShipment: new GetOrderShipment(orders, shipments, directory, clock, silentLogger),
    quoteCart: new QuoteCartShipping(cart, costs, directory),
    /** O comanda PAID de livrat, cu metoda de livrare data. */
    newOrder: (n: number, overrides: Partial<Omit<ShippableOrder, 'id'>> = {}): ShippableOrder =>
      orders.add(uuid(n), overrides),
  };
}

export type ShippingHarness = ReturnType<typeof buildShippingHarness>;
