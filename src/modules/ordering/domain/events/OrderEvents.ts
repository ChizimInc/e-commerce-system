import type { DomainEvent, Money } from '../../../../shared';
import type { Order } from '../Order';
import type { OrderStatus } from '../OrderTypes';

/** O linie din comanda, pe scurt: destul ca un abonat sa stie ce s-a comandat (fara date personale). */
export interface OrderEventLine {
  readonly itemId: string;
  readonly quantity: number;
}

/** Evenimentele nu poarta adresa de livrare sau alte date personale; abonatii le citesc din comanda daca au nevoie. */
interface OrderEventBase extends DomainEvent {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: Money;
  readonly items: readonly OrderEventLine[];
}

export interface OrderPlaced extends OrderEventBase {
  readonly type: 'OrderPlaced';
}
export interface OrderPaid extends OrderEventBase {
  readonly type: 'OrderPaid';
}
export interface OrderShipped extends OrderEventBase {
  readonly type: 'OrderShipped';
}
export interface OrderDelivered extends OrderEventBase {
  readonly type: 'OrderDelivered';
}
export interface OrderCancelled extends OrderEventBase {
  readonly type: 'OrderCancelled';
  /** A fost platita inainte de anulare (deci va trebui rambursata, Iteratia 4). */
  readonly wasPaid: boolean;
}

export type OrderEvent = OrderPlaced | OrderPaid | OrderShipped | OrderDelivered | OrderCancelled;
export type OrderEventType = OrderEvent['type'];

/** `Record` obliga sa fie listat fiecare tip de eveniment: unul nou, uitat aici, nu compileaza. */
const EVENT_TYPES: Record<OrderEventType, true> = {
  OrderPlaced: true,
  OrderPaid: true,
  OrderShipped: true,
  OrderDelivered: true,
  OrderCancelled: true,
};
export const ORDER_EVENT_TYPES = Object.keys(EVENT_TYPES) as readonly OrderEventType[];

/** Evenimentul emis la intrarea comenzii in fiecare stare; `null` = starea nu emite eveniment (REFUNDED: vine cu plata, Iteratia 4). */
const TYPE_OF_STATUS: Record<OrderStatus, OrderEventType | null> = {
  NEW: 'OrderPlaced',
  PAID: 'OrderPaid',
  SHIPPED: 'OrderShipped',
  DELIVERED: 'OrderDelivered',
  CANCELLED: 'OrderCancelled',
  REFUNDED: null,
};

/** Evenimentul de domeniu pentru starea in care se afla acum `order` (se apeleaza dupa ce tranzitia a fost salvata). */
export function eventForOrder(order: Order, occurredAt: Date): OrderEvent | null {
  const type = TYPE_OF_STATUS[order.status];
  if (type === null) return null;
  const base = {
    occurredAt,
    orderId: order.id,
    customerId: order.customerId,
    total: order.total,
    items: order.items.map(({ itemId, quantity }) => ({ itemId, quantity })),
  };
  if (type === 'OrderCancelled') return { ...base, type, wasPaid: order.paidAt !== null };
  return { ...base, type };
}
