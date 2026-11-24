import { DomainError, type Money } from '../../../shared';
import { requireText } from './validation';

export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 100;
/** Cel mai mare cuantum (in cenți) pe care il poate stoca coloana INTEGER din PostgreSQL. */
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export interface OrderItemProps {
  /** Id-ul produsului sau al pachetului din catalog la momentul comenzii. */
  readonly itemId: string;
  /** Numele din catalog, copiat la momentul comenzii (comanda ramane lizibila daca produsul se schimba). */
  readonly name: string;
  /** Pretul unitar copiat la momentul comenzii: o schimbare ulterioara de pret nu modifica comanda. */
  readonly unitPrice: Money;
  readonly quantity: number;
}

/** O linie dintr-o comanda: instantaneu (nume + pret + cantitate), nu o referinta vie la catalog. */
export class OrderItem {
  readonly itemId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;

  private constructor(props: OrderItemProps) {
    this.itemId = props.itemId;
    this.name = props.name;
    this.unitPrice = props.unitPrice;
    this.quantity = props.quantity;
  }

  static create(props: OrderItemProps): OrderItem {
    if (
      !Number.isInteger(props.quantity) ||
      props.quantity < 1 ||
      props.quantity > MAX_LINE_QUANTITY
    ) {
      throw new DomainError(
        `Cantitatea trebuie sa fie un numar intreg intre 1 si ${MAX_LINE_QUANTITY}`,
        'INVALID_QUANTITY',
      );
    }
    if (props.unitPrice.isNegative()) {
      throw new DomainError('Pretul unitar nu poate fi negativ', 'INVALID_ORDER');
    }
    if (props.unitPrice.amount > MAX_AMOUNT_CENTS) {
      throw new DomainError(
        'Pretul unitar depaseste limita permisa pentru o comanda',
        'INVALID_ORDER',
      );
    }
    return new OrderItem({
      itemId: props.itemId,
      name: requireText(props.name, 'Numele articolului', 200),
      unitPrice: props.unitPrice,
      quantity: props.quantity,
    });
  }

  lineTotal(): Money {
    return this.unitPrice.multiply(this.quantity);
  }
}
