import type { Order } from '../../domain/Order';

/**
 * Port de intrare pentru operatiile "de sistem" pe care le cere modulul `shipping`: citirea unei comenzi si
 * mutarea ei in SHIPPED dupa ce curierul a preluat coletul. Ca `OrderSettlement`, nu se expune prin HTTP:
 * autorizarea (doar ADMIN expediaza) e a modulului `shipping`.
 */
export interface OrderFulfillment {
  /** Comanda, fara verificare de proprietar; `null` daca nu exista. */
  find(orderId: string): Promise<Order | null>;
  /** PAID -> SHIPPED (emite `OrderShipped`). `INVALID_ORDER_TRANSITION` daca comanda nu mai e PAID, `ORDER_CHANGED` la concurenta. */
  markShipped(orderId: string): Promise<Order>;
}
