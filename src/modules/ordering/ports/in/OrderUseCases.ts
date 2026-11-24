import type { Principal } from '../../../../shared';
import type { AddressProps } from '../../domain/Address';
import type { Order } from '../../domain/Order';
import type { DeliveryMethod, OrderStatus, PaymentMethod } from '../../domain/OrderTypes';

export interface PlaceOrderInput {
  readonly address: AddressProps;
  readonly deliveryMethod: DeliveryMethod;
  readonly paymentMethod: PaymentMethod;
}

export interface ListOrdersQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface OrderPage {
  readonly items: Order[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Port de intrare: operatiile pe comenzi. Apelantul (`Principal`) decide ce comenzi are voie sa vada. */
export interface OrderUseCases {
  /** Creeaza o comanda din cosul apelantului: scade stocul si goleste cosul, intr-o singura tranzactie. */
  placeOrder(principal: Principal, input: PlaceOrderInput): Promise<Order>;
  /** Istoricul comenzilor apelantului, cele mai noi primele. */
  listMyOrders(principal: Principal, query: ListOrdersQuery): Promise<OrderPage>;
  /** Clientul vede doar comenzile lui (altfel `NotFoundError`); ADMIN poate vedea orice comanda. */
  getOrder(principal: Principal, orderId: string): Promise<Order>;
  /** Doar ADMIN: muta comanda in statusul cerut, daca tranzitia e permisa de ciclul de viata. */
  changeStatus(principal: Principal, orderId: string, target: OrderStatus): Promise<Order>;
}
