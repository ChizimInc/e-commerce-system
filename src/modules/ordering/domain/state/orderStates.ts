import { CancelledState } from './CancelledState';
import { DeliveredState } from './DeliveredState';
import { NewState } from './NewState';
import type { OrderState } from './OrderState';
import { PaidState } from './PaidState';
import { RefundedState } from './RefundedState';
import { ShippedState } from './ShippedState';
import type { OrderStatus } from '../OrderTypes';

const STATE_FACTORIES: Record<OrderStatus, (wasPaid: boolean) => OrderState> = {
  NEW: () => new NewState(),
  PAID: () => new PaidState(),
  SHIPPED: () => new ShippedState(),
  DELIVERED: () => new DeliveredState(),
  CANCELLED: (wasPaid) => new CancelledState({ wasPaid }),
  REFUNDED: () => new RefundedState(),
};

/** Reconstruieste obiectul-stare al unei comenzi salvate (status + daca a fost platita vreodata). */
export function stateFor(status: OrderStatus, wasPaid: boolean): OrderState {
  return STATE_FACTORIES[status](wasPaid);
}
