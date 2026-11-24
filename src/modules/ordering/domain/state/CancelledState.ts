import { BaseOrderState, type OrderState } from './OrderState';
import { RefundedState } from './RefundedState';

// Pattern: State (Behavioral) – starea CANCELLED: o comanda platita si apoi anulata se poate rambursa; una anulata inainte de plata nu
export class CancelledState extends BaseOrderState {
  /** `wasPaid`: comanda a fost platita inainte de anulare (doar atunci exista ceva de rambursat). */
  constructor(private readonly options: { readonly wasPaid: boolean }) {
    super('CANCELLED');
  }

  override refund(): OrderState {
    // Cele doua cazuri difera doar prin aceasta garda; restul tranzitiilor raman refuzate de baza.
    return this.options.wasPaid ? new RefundedState() : super.refund();
  }
}
