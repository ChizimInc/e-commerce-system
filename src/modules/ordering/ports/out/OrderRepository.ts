import type { Order } from '../../domain/Order';
import type { OrderStatus } from '../../domain/OrderTypes';

export interface OrderListFilter {
  readonly customerId: string;
  readonly limit: number;
  readonly offset: number;
}

/** Port de iesire pentru persistenta comenzilor. */
export interface OrderRepository {
  /** Insereaza o comanda noua (cu articolele ei). */
  add(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /** Comenzile unui client, cele mai noi primele (ordine stabila pentru paginare), plus totalul. */
  findByCustomerId(filter: OrderListFilter): Promise<{ items: Order[]; total: number }>;
  /** Cate comenzi a plasat clientul de la `since` incoace (inclusiv); folosit de verificarea anti-frauda. */
  countByCustomerSince(customerId: string, since: Date): Promise<number>;
  /**
   * Salveaza noul status al comenzii DOAR daca statusul din baza este inca `expectedStatus`
   * (concurenta optimista): doua tranzitii simultane din aceeasi stare nu se pot suprapune.
   * Arunca `NotFoundError` daca comanda nu exista si `ConflictError(ORDER_CHANGED)` daca statusul s-a schimbat intre timp.
   */
  updateStatus(order: Order, expectedStatus: OrderStatus): Promise<void>;
}
