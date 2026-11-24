import {
  ForbiddenError,
  NotFoundError,
  type DomainEvent,
  type EventBus,
  type IdGenerator,
  type Logger,
  type Principal,
} from '../../../shared';
import { Address } from '../domain/Address';
import type { Order } from '../domain/Order';
import { OrderBuilder } from '../domain/OrderBuilder';
import type { OrderStatus } from '../domain/OrderTypes';
import { eventForOrder } from '../domain/events/OrderEvents';
import type { PricingPolicy } from '../domain/pricing/PricingPolicy';
import type {
  ListOrdersQuery,
  OrderPage,
  OrderUseCases,
  PlaceOrderInput,
} from '../ports/in/OrderUseCases';
import type { CartSource } from '../ports/out/CartSource';
import type { OrderCatalog } from '../ports/out/OrderCatalog';
import type { ConsumedCartLine, OrderPlacement } from '../ports/out/OrderPlacement';
import type { OrderRepository } from '../ports/out/OrderRepository';
import { aggregateStock } from './stockRequirements';
import type { CheckoutLine, CheckoutValidator } from './validation/CheckoutValidator';

/** Cazurile de utilizare ale comenzilor: creare din cos, istoric, detalii, schimbare de status (admin). */
export class OrderService implements OrderUseCases {
  /**
   * @param validation capul lantului de validare a checkout-ului (Chain of Responsibility), asamblat in
   *   composition root: verigi noi se adauga acolo, fara sa se modifice acest serviciu.
   * @param pricing regulile de pret (reduceri, TVA) aplicate la crearea comenzii
   * @param events magistrala pe care se publica evenimentele de domeniu, dupa ce tranzitia a fost salvata
   */
  constructor(
    private readonly orders: OrderRepository,
    private readonly cart: CartSource,
    private readonly catalog: OrderCatalog,
    private readonly placement: OrderPlacement,
    private readonly validation: CheckoutValidator,
    private readonly pricing: PricingPolicy,
    private readonly events: EventBus,
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
      .pricing(this.pricing)
      .build();

    // Lantul de validare ruleaza inainte de plasare: prima veriga care refuza opreste comanda.
    await this.validation.validate({ order, lines: resolved });

    await this.placement.place({ order, stock: aggregateStock(resolved), cartLines });
    this.logger.info('Comanda plasata', {
      orderId: order.id,
      customerId: order.customerId,
      total: order.total.toString(),
    });
    await this.emit(eventForOrder(order, new Date()));
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
    await this.emit(eventForOrder(updated, new Date()));
    return updated;
  }

  /**
   * Publica un eveniment DUPA ce schimbarea a fost salvata. Un eveniment care nu poate fi livrat nu
   * trebuie sa strice comanda deja salvata, deci erorile se logheaza, nu se propaga.
   */
  private async emit(event: DomainEvent | null): Promise<void> {
    if (!event) return;
    try {
      await this.events.publish(event);
    } catch (error) {
      this.logger.error('Evenimentul nu a putut fi publicat', { eventType: event.type, error });
    }
  }

  /** Rezolva liniile cosului cu datele curente din catalog; stocul se verifica apoi in lantul de validare. */
  private async resolve(lines: readonly ConsumedCartLine[]): Promise<CheckoutLine[]> {
    return Promise.all(
      lines.map(async ({ itemId, quantity }) => {
        const item = await this.catalog.find(itemId);
        if (!item) throw new NotFoundError('Produs', itemId);
        return { item, quantity };
      }),
    );
  }
}
