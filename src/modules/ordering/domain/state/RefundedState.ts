import { BaseOrderState } from './OrderState';

// Pattern: State (Behavioral) – starea REFUNDED: stare finala (comanda anulata si rambursata)
export class RefundedState extends BaseOrderState {
  constructor() {
    super('REFUNDED');
  }
}
