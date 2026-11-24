import { BaseOrderState } from './OrderState';

// Pattern: State (Behavioral) – starea DELIVERED: stare finala, nicio tranzitie permisa
export class DeliveredState extends BaseOrderState {
  constructor() {
    super('DELIVERED');
  }
}
