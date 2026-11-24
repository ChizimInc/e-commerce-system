import type { Money } from '../../../../shared';
import type { PaymentMethod } from '../../domain/PaymentTypes';

/**
 * Ce stie modulul `payments` despre o comanda (nu depinde de modelul modulului `ordering`):
 *  - `AWAITING_PAYMENT`: comanda e NEW, deci poate fi platita;
 *  - `PAID`: a fost deja platita (si e, eventual, expediata, anulata sau rambursata ulterior);
 *  - `CLOSED`: nu mai poate fi platita (anulata inainte de plata).
 */
export type PayableOrderState = 'AWAITING_PAYMENT' | 'PAID' | 'CLOSED';

export interface PayableOrder {
  readonly id: string;
  readonly customerId: string;
  readonly total: Money;
  readonly paymentMethod: PaymentMethod;
  readonly state: PayableOrderState;
}

/** Port de iesire: legatura cu comenzile (anti-corruption layer catre modulul `ordering`). */
export interface PayableOrders {
  find(orderId: string): Promise<PayableOrder | null>;
  /** NEW -> PAID (emite `OrderPaid`). Arunca daca comanda nu mai e NEW (ex. anulata intre timp). */
  markPaid(orderId: string): Promise<void>;
  /** CANCELLED -> REFUNDED. Idempotent: o comanda deja rambursata ramane neschimbata. */
  markRefunded(orderId: string): Promise<void>;
}
