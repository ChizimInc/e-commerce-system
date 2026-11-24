import { DomainError, type Money } from '../../../shared';
import type { Address } from './Address';
import { Order } from './Order';
import { OrderItem, type OrderItemProps } from './OrderItem';
import {
  DELIVERY_METHODS,
  PAYMENT_METHODS,
  type DeliveryMethod,
  type PaymentMethod,
} from './OrderTypes';

// Pattern: Builder (Creational) – construieste pas cu pas o comanda (client, articole, adresa, livrare, plata) si o valideaza la build()
export class OrderBuilder {
  private customerId: string | undefined;
  private readonly items: OrderItem[] = [];
  private address: Address | undefined;
  private deliveryMethod: DeliveryMethod | undefined;
  private paymentMethod: PaymentMethod | undefined;
  private createdAt: Date | undefined;

  private constructor(private readonly id: string) {}

  static forOrder(id: string): OrderBuilder {
    return new OrderBuilder(id);
  }

  customer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  /** Adauga o linie; pretul si numele se copiaza acum (instantaneu la momentul comenzii). */
  addItem(item: OrderItemProps): this {
    this.items.push(OrderItem.create(item));
    return this;
  }

  /** Adauga mai multe linii, de ex. cele din cos. */
  addItems(items: readonly OrderItemProps[]): this {
    items.forEach((item) => this.addItem(item));
    return this;
  }

  shippingAddress(address: Address): this {
    this.address = address;
    return this;
  }

  delivery(method: DeliveryMethod): this {
    this.deliveryMethod = method;
    return this;
  }

  payment(method: PaymentMethod): this {
    this.paymentMethod = method;
    return this;
  }

  /** Optional: momentul plasarii (implicit, momentul `build()`). */
  placedAt(date: Date): this {
    this.createdAt = date;
    return this;
  }

  /** Verifica ca toti pasii obligatorii au fost facuti, apoi construieste comanda (starea NEW). */
  build(): Order {
    const customerId = this.customerId?.trim();
    const { address, deliveryMethod, paymentMethod } = this;
    const hasDelivery = deliveryMethod !== undefined && DELIVERY_METHODS.includes(deliveryMethod);
    const hasPayment = paymentMethod !== undefined && PAYMENT_METHODS.includes(paymentMethod);

    const missing: string[] = [];
    if (!customerId) missing.push('clientul');
    if (this.items.length === 0) missing.push('articolele');
    if (!address) missing.push('adresa');
    if (!hasDelivery) missing.push('metoda de livrare');
    if (!hasPayment) missing.push('metoda de plata');
    if (!customerId || !address || !deliveryMethod || !paymentMethod || missing.length > 0) {
      throw new DomainError(`Comanda incompleta, lipsesc: ${missing.join(', ')}`, 'INVALID_ORDER');
    }

    return Order.create({
      id: this.id,
      customerId,
      items: [...this.items],
      address,
      deliveryMethod,
      paymentMethod,
      total: this.subtotal(),
      createdAt: this.createdAt ?? new Date(),
    });
  }

  /** Suma liniilor; `Money` refuza moneda diferita intre linii. Apelata doar dupa verificarea ca exista linii. */
  private subtotal(): Money {
    const [first, ...rest] = this.items;
    if (!first) {
      throw new DomainError('Comanda trebuie sa contina cel putin un articol', 'INVALID_ORDER');
    }
    return rest.reduce((sum, item) => sum.add(item.lineTotal()), first.lineTotal());
  }
}
