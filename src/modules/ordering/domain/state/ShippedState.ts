import { DeliveredState } from './DeliveredState';
import { BaseOrderState, type OrderState } from './OrderState';

// Pattern: State (Behavioral) – starea SHIPPED: comanda expediata; singura tranzitie permisa este livrarea
export class ShippedState extends BaseOrderState {
  constructor() {
    super('SHIPPED');
  }

  override deliver(): OrderState {
    return new DeliveredState();
  }
}
