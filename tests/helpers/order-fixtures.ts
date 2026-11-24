import { Money } from '../../src/shared';
import { Address, type AddressProps } from '../../src/modules/ordering/domain/Address';
import type { Order } from '../../src/modules/ordering/domain/Order';
import { OrderBuilder } from '../../src/modules/ordering/domain/OrderBuilder';
import type { OrderItemProps } from '../../src/modules/ordering/domain/OrderItem';
import type { OrderStatus } from '../../src/modules/ordering/domain/OrderTypes';
import { uuid } from './ids';

export const ADDRESS_PROPS: AddressProps = {
  recipientName: 'Ana Popescu',
  street: 'Str. Libertatii 10',
  city: 'Chisinau',
  postalCode: 'MD-2001',
  country: 'MD',
};

export const makeAddress = (overrides: Partial<AddressProps> = {}): Address =>
  Address.of({ ...ADDRESS_PROPS, ...overrides });

export const makeLine = (overrides: Partial<OrderItemProps> = {}): OrderItemProps => ({
  itemId: uuid(1),
  name: 'Tastatura',
  unitPrice: Money.of(10_000, 'RON'),
  quantity: 2,
  ...overrides,
});

/** O comanda NEW valida (2 x 100.00 RON), construita prin `OrderBuilder`. */
export function makeOrder(
  overrides: { id?: string; customerId?: string; lines?: OrderItemProps[]; createdAt?: Date } = {},
): Order {
  return OrderBuilder.forOrder(overrides.id ?? uuid(500))
    .customer(overrides.customerId ?? uuid(900))
    .addItems(overrides.lines ?? [makeLine()])
    .shippingAddress(makeAddress())
    .delivery('STANDARD')
    .payment('CARD')
    .placedAt(overrides.createdAt ?? new Date('2026-01-02T03:04:05.000Z'))
    .build();
}

/** Calea (din starea NEW) prin care se ajunge in fiecare stare, folosind doar API-ul public al comenzii. */
export const PATH_TO_STATE: Record<string, (order: Order) => Order> = {
  NEW: (o) => o,
  PAID: (o) => o.pay(),
  SHIPPED: (o) => o.pay().ship(),
  DELIVERED: (o) => o.pay().ship().deliver(),
  CANCELLED_UNPAID: (o) => o.cancel(),
  CANCELLED_PAID: (o) => o.pay().cancel(),
  REFUNDED: (o) => o.pay().cancel().refund(),
};

export const STATUS_OF_PATH: Record<string, OrderStatus> = {
  NEW: 'NEW',
  PAID: 'PAID',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED_UNPAID: 'CANCELLED',
  CANCELLED_PAID: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};
