import { DomainError, type Money } from '../../../shared';
import type { Address } from './Address';
import { MAX_AMOUNT_CENTS, MAX_ORDER_LINES, type OrderItem } from './OrderItem';
import type { DeliveryMethod, OrderStatus, PaymentMethod } from './OrderTypes';
import { invalidTransition, type OrderState } from './state/OrderState';
import { NewState } from './state/NewState';
import { stateFor } from './state/orderStates';

export interface OrderProps {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  readonly address: Address;
  readonly deliveryMethod: DeliveryMethod;
  readonly paymentMethod: PaymentMethod;
  /** Totalul comenzii (acum suma liniilor; reducerile/taxele se adauga in Iteratia 3 partea B). */
  readonly total: Money;
  readonly createdAt: Date;
}

export interface RestoreOrderProps extends OrderProps {
  readonly status: OrderStatus;
  /** Momentul platii; `null` daca comanda nu a fost platita niciodata (de aici se stie si daca o anulare e rambursabila). */
  readonly paidAt: Date | null;
}

/** Tranzitiile cerute din exterior (admin) dupa statusul-tinta; fiecare ruleaza metoda corespunzatoare. */
const TRANSITIONS: Record<OrderStatus, (order: Order, at: Date) => Order> = {
  NEW: (order) => {
    throw invalidTransition(order.status, 'NEW');
  },
  PAID: (order, at) => order.pay(at),
  SHIPPED: (order) => order.ship(),
  DELIVERED: (order) => order.deliver(),
  CANCELLED: (order) => order.cancel(),
  REFUNDED: (order) => order.refund(),
};

// Pattern: State (Behavioral) – contextul: Order isi delega ciclul de viata obiectului-stare curent (vezi domain/state/)
/**
 * Comanda (agregat). Imutabila: o tranzitie intoarce o comanda noua, deci una refuzata nu poate
 * lasa comanda intr-o stare partiala. Ciclul de viata este delegat obiectului-stare (State).
 */
export class Order {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  readonly address: Address;
  readonly deliveryMethod: DeliveryMethod;
  readonly paymentMethod: PaymentMethod;
  readonly total: Money;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  private readonly state: OrderState;

  private constructor(props: OrderProps, state: OrderState, paidAt: Date | null) {
    this.id = props.id;
    this.customerId = props.customerId;
    this.items = props.items;
    this.address = props.address;
    this.deliveryMethod = props.deliveryMethod;
    this.paymentMethod = props.paymentMethod;
    this.total = props.total;
    this.createdAt = props.createdAt;
    this.paidAt = paidAt;
    this.state = state;
  }

  /** O comanda noua porneste mereu in starea NEW. De obicei se construieste prin `OrderBuilder`. */
  static create(props: OrderProps): Order {
    Order.assertInvariants(props);
    return new Order(props, new NewState(), null);
  }

  /** Reconstruieste o comanda salvata (repository-urile), cu starea ei. */
  static restore(props: RestoreOrderProps): Order {
    Order.assertInvariants(props);
    return new Order(props, stateFor(props.status, props.paidAt !== null), props.paidAt);
  }

  get status(): OrderStatus {
    return this.state.status;
  }

  pay(at: Date = new Date()): Order {
    return this.moveTo(this.state.pay(), at);
  }

  ship(): Order {
    return this.moveTo(this.state.ship(), this.paidAt);
  }

  deliver(): Order {
    return this.moveTo(this.state.deliver(), this.paidAt);
  }

  cancel(): Order {
    return this.moveTo(this.state.cancel(), this.paidAt);
  }

  refund(): Order {
    return this.moveTo(this.state.refund(), this.paidAt);
  }

  /** Aplica tranzitia care duce la `target` (ex. cererea unui admin); arunca daca nu e permisa din starea curenta. */
  transitionTo(target: OrderStatus, at: Date = new Date()): Order {
    return TRANSITIONS[target](this, at);
  }

  private moveTo(state: OrderState, paidAt: Date | null): Order {
    return new Order(this, state, paidAt);
  }

  private static assertInvariants(props: OrderProps): void {
    if (props.items.length === 0) {
      throw new DomainError('Comanda trebuie sa contina cel putin un articol', 'INVALID_ORDER');
    }
    if (props.items.length > MAX_ORDER_LINES) {
      throw new DomainError(
        `Comanda poate avea cel mult ${MAX_ORDER_LINES} de articole diferite`,
        'INVALID_ORDER',
      );
    }
    const seen = new Set<string>();
    for (const item of props.items) {
      if (seen.has(item.itemId)) {
        throw new DomainError(`Articol duplicat in comanda: ${item.itemId}`, 'INVALID_ORDER');
      }
      seen.add(item.itemId);
      if (item.unitPrice.currency !== props.total.currency) {
        throw new DomainError('Toate articolele trebuie sa aiba moneda totalului', 'INVALID_ORDER');
      }
    }
    if (props.total.isNegative()) {
      throw new DomainError('Totalul comenzii nu poate fi negativ', 'INVALID_ORDER');
    }
    if (props.total.amount > MAX_AMOUNT_CENTS) {
      throw new DomainError('Totalul comenzii depaseste limita permisa', 'INVALID_ORDER');
    }
  }
}
