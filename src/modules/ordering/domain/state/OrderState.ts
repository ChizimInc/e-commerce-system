import { DomainError } from '../../../../shared';
import type { OrderStatus } from '../OrderTypes';

// Pattern: State (Behavioral) – interfata comuna a starilor; Order (contextul) delega fiecare actiune obiectului-stare curent
/**
 * Interfata comuna a starilor unei comenzi. Fiecare actiune intoarce starea urmatoare sau
 * arunca `DomainError(INVALID_ORDER_TRANSITION)` daca nu e permisa din starea curenta.
 */
export interface OrderState {
  readonly status: OrderStatus;
  pay(): OrderState;
  ship(): OrderState;
  deliver(): OrderState;
  cancel(): OrderState;
  refund(): OrderState;
}

export function invalidTransition(from: OrderStatus, to: OrderStatus): DomainError {
  return new DomainError(
    `Tranzitie invalida a comenzii: ${from} -> ${to}`,
    'INVALID_ORDER_TRANSITION',
  );
}

// Pattern: State (Behavioral) – baza starilor concrete: refuza implicit orice tranzitie, fiecare stare o permite doar pe cele valide
/**
 * Baza starilor concrete: refuza orice tranzitie. O stare concreta suprascrie doar tranzitiile
 * pe care le permite, deci lista tranzitiilor valide este vizibila direct in clasa ei, fara `if/switch`.
 */
export abstract class BaseOrderState implements OrderState {
  protected constructor(readonly status: OrderStatus) {}

  pay(): OrderState {
    throw invalidTransition(this.status, 'PAID');
  }

  ship(): OrderState {
    throw invalidTransition(this.status, 'SHIPPED');
  }

  deliver(): OrderState {
    throw invalidTransition(this.status, 'DELIVERED');
  }

  cancel(): OrderState {
    throw invalidTransition(this.status, 'CANCELLED');
  }

  refund(): OrderState {
    throw invalidTransition(this.status, 'REFUNDED');
  }
}
