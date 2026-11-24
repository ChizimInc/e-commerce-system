import type { Order } from '../../../ordering/domain/Order';
import type { OrderSettlement } from '../../../ordering/ports/in/OrderSettlement';
import type { PayableOrder, PayableOrders } from '../../ports/out/PayableOrders';

/** Cum vede `payments` starea unei comenzi: NEW se poate plati; orice comanda cu `paidAt` a fost deja platita. */
function toPayableOrder(order: Order): PayableOrder {
  return {
    id: order.id,
    customerId: order.customerId,
    total: order.total,
    // Compilatorul refuza asignarea daca modulul `ordering` adauga o metoda de plata necunoscuta aici.
    paymentMethod: order.paymentMethod,
    state: order.status === 'NEW' ? 'AWAITING_PAYMENT' : order.paidAt !== null ? 'PAID' : 'CLOSED',
  };
}

// Pattern: Adapter (Structural) – anti-corruption layer: aduce comanda din `ordering` (OrderSettlement) la portul PayableOrders al modulului `payments`
/** Anti-corruption layer: `payments` citeste si deconteaza comenzile prin portul de intrare al modulului `ordering`. */
export class OrderSettlementPayableOrders implements PayableOrders {
  constructor(private readonly orders: OrderSettlement) {}

  async find(orderId: string): Promise<PayableOrder | null> {
    const order = await this.orders.find(orderId);
    return order ? toPayableOrder(order) : null;
  }

  async markPaid(orderId: string): Promise<void> {
    await this.orders.markPaid(orderId);
  }

  async markRefunded(orderId: string): Promise<void> {
    await this.orders.markRefunded(orderId);
  }
}
