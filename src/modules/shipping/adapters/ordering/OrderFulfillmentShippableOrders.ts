import type { Order } from '../../../ordering/domain/Order';
import type { OrderFulfillment } from '../../../ordering/ports/in/OrderFulfillment';
import type { ShippableOrder, ShippableOrders } from '../../ports/out/ShippableOrders';

/** Cum vede `shipping` starea unei comenzi: PAID se poate expedia; SHIPPED / DELIVERED au fost deja expediate; restul nu. */
function toShippableOrder(order: Order): ShippableOrder {
  const state =
    order.status === 'PAID'
      ? 'AWAITING_SHIPMENT'
      : order.status === 'SHIPPED' || order.status === 'DELIVERED'
        ? 'SHIPPED'
        : 'NOT_SHIPPABLE';
  return {
    id: order.id,
    customerId: order.customerId,
    state,
    // Compilatorul refuza asignarea daca modulul `ordering` adauga o metoda de livrare necunoscuta aici.
    deliveryMethod: order.deliveryMethod,
    recipient: {
      name: order.address.recipientName,
      street: order.address.street,
      city: order.address.city,
      postalCode: order.address.postalCode,
      country: order.address.country,
    },
    units: order.items.reduce((count, item) => count + item.quantity, 0),
    total: order.total,
    shippingCost: order.price.shipping,
  };
}

// Pattern: Adapter (Structural) – anti-corruption layer: aduce comanda din `ordering` (OrderFulfillment) la portul ShippableOrders al modulului `shipping`
/** Anti-corruption layer: `shipping` citeste si expediaza comenzile prin portul de intrare al modulului `ordering`. */
export class OrderFulfillmentShippableOrders implements ShippableOrders {
  constructor(private readonly orders: OrderFulfillment) {}

  async find(orderId: string): Promise<ShippableOrder | null> {
    const order = await this.orders.find(orderId);
    return order ? toShippableOrder(order) : null;
  }

  async markShipped(orderId: string): Promise<void> {
    await this.orders.markShipped(orderId);
  }
}
