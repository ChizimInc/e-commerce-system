import { CancelledState } from './CancelledState';
import { BaseOrderState, type OrderState } from './OrderState';
import { ShippedState } from './ShippedState';

// Pattern: State (Behavioral) – starea PAID: comanda platita; poate fi expediata sau anulata (apoi rambursata)
export class PaidState extends BaseOrderState {
  constructor() {
    super('PAID');
  }

  override ship(): OrderState {
    return new ShippedState();
  }

  override cancel(): OrderState {
    return new CancelledState({ wasPaid: true });
  }
}
