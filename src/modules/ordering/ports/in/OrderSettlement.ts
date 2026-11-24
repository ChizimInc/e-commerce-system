import type { Order } from '../../domain/Order';

/**
 * Port de intrare pentru operatiile "de sistem" pe care le cere modulul `payments`: citirea unei comenzi
 * si mutarea ei in PAID / REFUNDED dupa ce banii s-au miscat. Spre deosebire de `OrderUseCases.changeStatus`
 * (doar ADMIN), apelantul nu e un utilizator: autorizarea (cine are voie sa plateasca) e a modulului `payments`.
 * Nu se expune prin HTTP.
 */
export interface OrderSettlement {
  /** Comanda, fara verificare de proprietar; `null` daca nu exista. */
  find(orderId: string): Promise<Order | null>;
  /** NEW -> PAID (emite `OrderPaid`). `INVALID_ORDER_TRANSITION` daca comanda nu mai e NEW, `ORDER_CHANGED` la concurenta. */
  markPaid(orderId: string): Promise<Order>;
  /** CANCELLED -> REFUNDED, doar pentru o comanda platita (emite `OrderRefunded`). */
  markRefunded(orderId: string): Promise<Order>;
}
