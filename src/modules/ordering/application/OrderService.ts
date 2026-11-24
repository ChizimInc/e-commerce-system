import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type IdGenerator,
  type Logger,
  type Principal,
} from '../../../shared';
import { Address } from '../domain/Address';
import type { Order } from '../domain/Order';
import { OrderBuilder } from '../domain/OrderBuilder';
import type { OrderStatus } from '../domain/OrderTypes';
import type {
  ListOrdersQuery,
  OrderPage,
  OrderUseCases,
  PlaceOrderInput,
} from '../ports/in/OrderUseCases';
import type { CartSource } from '../ports/out/CartSource';
import type { OrderCatalog, OrderableItem } from '../ports/out/OrderCatalog';
import type { ConsumedCartLine, StockDeduction } from '../ports/out/OrderPlacement';
import type { OrderPlacement } from '../ports/out/OrderPlacement';
import type { OrderRepository } from '../ports/out/OrderRepository';

/** Cazurile de utilizare ale comenzilor: creare din cos, istoric, detalii, schimbare de status (admin). */
export class OrderService implements OrderUseCases {
  constructor(
    private readonly orders: OrderRepository,
    private readonly cart: CartSource,
    private readonly catalog: OrderCatalog,
    private readonly placement: OrderPlacement,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  async placeOrder(principal: Principal, input: PlaceOrderInput): Promise<Order> {
    const cartLines = await this.cart.linesOf(principal.userId);
    const resolved = await this.resolve(cartLines);

    const order = OrderBuilder.forOrder(this.ids.next())
      .customer(principal.userId)
      .addItems(
        resolved.map(({ item, quantity }) => ({
          itemId: item.id,
          name: item.name,
          unitPrice: item.unitPrice,
          quantity,
        })),
      )
      .shippingAddress(Address.of(input.address))
      .delivery(input.deliveryMethod)
      .payment(input.paymentMethod)
      .build();

    await this.placement.place({ order, stock: stockToDeduct(resolved), cartLines });
    this.logger.info('Comanda plasata', {
      orderId: order.id,
      customerId: order.customerId,
      total: order.total.toString(),
    });
    return order;
  }

  async listMyOrders(principal: Principal, query: ListOrdersQuery): Promise<OrderPage> {
    const { items, total } = await this.orders.findByCustomerId({
      customerId: principal.userId,
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async getOrder(principal: Principal, orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    // Comanda altcuiva se raporteaza ca inexistenta (nu 403), ca sa nu confirmam ca exista.
    if (!order || (principal.role !== 'ADMIN' && order.customerId !== principal.userId)) {
      throw new NotFoundError('Comanda', orderId);
    }
    return order;
  }

  async changeStatus(principal: Principal, orderId: string, target: OrderStatus): Promise<Order> {
    if (principal.role !== 'ADMIN') throw new ForbiddenError();
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundError('Comanda', orderId);

    const updated = order.transitionTo(target);
    await this.orders.updateStatus(updated, order.status);
    this.logger.info('Status comanda schimbat', {
      orderId,
      from: order.status,
      to: updated.status,
      adminId: principal.userId,
    });
    return updated;
  }

  /** Rezolva liniile cosului cu datele curente din catalog si verifica stocul inainte de a construi comanda. */
  private async resolve(
    lines: readonly ConsumedCartLine[],
  ): Promise<{ item: OrderableItem; quantity: number }[]> {
    return Promise.all(
      lines.map(async ({ itemId, quantity }) => {
        const item = await this.catalog.find(itemId);
        if (!item) throw new NotFoundError('Produs', itemId);
        if (quantity > item.availableStock) {
          throw new ConflictError(
            `Stoc insuficient pentru "${item.name}": ai cerut ${quantity}, disponibil ${item.availableStock}`,
            'INSUFFICIENT_STOCK',
          );
        }
        return { item, quantity };
      }),
    );
  }
}

/**
 * Stocul de scazut, pe produse simple: un pachet consuma stocul componentelor, iar acelasi produs
 * poate aparea in mai multe linii (singur si in pachete), deci cantitatile se aduna pe produs.
 */
function stockToDeduct(
  resolved: readonly { item: OrderableItem; quantity: number }[],
): StockDeduction[] {
  const byProduct = new Map<string, number>();
  for (const { item, quantity } of resolved) {
    for (const part of item.stockPerUnit) {
      byProduct.set(
        part.productId,
        (byProduct.get(part.productId) ?? 0) + part.quantity * quantity,
      );
    }
  }
  return [...byProduct].map(([productId, quantity]) => ({ productId, quantity }));
}
