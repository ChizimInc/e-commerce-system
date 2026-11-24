import { CancelledState } from './CancelledState';
import { BaseOrderState, type OrderState } from './OrderState';
import { PaidState } from './PaidState';

// Pattern: State (Behavioral) – starea NEW: comanda plasata, neplatita; poate fi platita sau anulata (nimic de rambursat)
export class NewState extends BaseOrderState {
  constructor() {
    super('NEW');
  }

  override pay(): OrderState {
    return new PaidState();
  }

  override cancel(): OrderState {
    return new CancelledState({ wasPaid: false });
  }
}
