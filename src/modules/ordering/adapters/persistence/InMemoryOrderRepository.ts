import { ConflictError, NotFoundError } from '../../../../shared';
import type { Order } from '../../domain/Order';
import type { OrderStatus } from '../../domain/OrderTypes';
import type { OrderListFilter, OrderRepository } from '../../ports/out/OrderRepository';

/** Adaptor in-memory pentru `OrderRepository`. Comenzile sunt imutabile, deci se pastreaza direct. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, Order>();

  add(order: Order): Promise<void> {
    if (this.store.has(order.id)) {
      return Promise.reject(new ConflictError('Comanda exista deja', 'ORDER_EXISTS'));
    }
    this.store.set(order.id, order);
    return Promise.resolve();
  }

  findById(id: string): Promise<Order | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findByCustomerId({
    customerId,
    limit,
    offset,
  }: OrderListFilter): Promise<{ items: Order[]; total: number }> {
    const mine = [...this.store.values()]
      .filter((order) => order.customerId === customerId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
    return Promise.resolve({ items: mine.slice(offset, offset + limit), total: mine.length });
  }

  countByCustomerSince(customerId: string, since: Date): Promise<number> {
    const count = [...this.store.values()].filter(
      (order) => order.customerId === customerId && order.createdAt >= since,
    ).length;
    return Promise.resolve(count);
  }

  updateStatus(order: Order, expectedStatus: OrderStatus): Promise<void> {
    const current = this.store.get(order.id);
    if (!current) return Promise.reject(new NotFoundError('Comanda', order.id));
    if (current.status !== expectedStatus) {
      return Promise.reject(
        new ConflictError('Comanda a fost modificata simultan, reincearca', 'ORDER_CHANGED'),
      );
    }
    this.store.set(order.id, order);
    return Promise.resolve();
  }
}
