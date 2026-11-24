import { DomainError, type Money } from '../../../../shared';
import { MAX_AMOUNT_CENTS } from '../OrderItem';

export interface PriceBreakdownParts {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly vat: Money;
  /** Costul livrarii (implicit 0): se adauga dupa reducere si intra in baza de calcul a TVA. */
  readonly shipping?: Money;
}

/**
 * Rezultatul calculului de pret al unei comenzi, in cenți (`Money`):
 * `total = subtotal - discount + shipping + vat` (livrarea se adauga dupa reducere, iar TVA se aplica pe
 * subtotalul redus plus livrare). Imutabil.
 * Fiecare suma trebuie sa incapa intr-un INTEGER PostgreSQL, deci un calcul care depaseste limita
 * (de ex. TVA adaugat la un subtotal aproape de maxim) e refuzat aici, cu eroare de domeniu, nu in baza de date.
 */
export class PriceBreakdown {
  private constructor(
    readonly subtotal: Money,
    readonly discount: Money,
    readonly shipping: Money,
    readonly vat: Money,
    readonly total: Money,
  ) {
    // Partile se verifica inainte de total, ca mesajul sa arate cauza (o parte negativa, nu un total negativ).
    PriceBreakdown.assertAmount('Subtotalul', subtotal);
    PriceBreakdown.assertAmount('Reducerea', discount);
    PriceBreakdown.assertAmount('Costul livrarii', shipping);
    PriceBreakdown.assertAmount('TVA', vat);
    if (discount.isGreaterThan(subtotal)) {
      throw new DomainError('Reducerea nu poate depasi subtotalul', 'INVALID_ORDER');
    }
    PriceBreakdown.assertAmount('Totalul', total);
  }

  /** O suma a comenzii: nenegativa si in limita unui INTEGER PostgreSQL. */
  private static assertAmount(label: string, money: Money): void {
    if (money.isNegative()) {
      throw new DomainError(`${label} comenzii nu poate fi negativ`, 'INVALID_ORDER');
    }
    if (money.amount > MAX_AMOUNT_CENTS) {
      throw new DomainError(`${label} comenzii depaseste limita permisa`, 'INVALID_ORDER');
    }
  }

  /** Calculeaza totalul din parti; `Money` refuza monede diferite, iar reducerea nu poate depasi subtotalul. */
  static of({ subtotal, discount, vat, shipping }: PriceBreakdownParts): PriceBreakdown {
    const delivery = shipping ?? subtotal.subtract(subtotal);
    return new PriceBreakdown(
      subtotal,
      discount,
      delivery,
      vat,
      subtotal.subtract(discount).add(delivery).add(vat),
    );
  }

  /** Reconstruieste din valori salvate; un total care nu corespunde partilor indica date corupte. */
  static restore(parts: PriceBreakdownParts & { readonly total: Money }): PriceBreakdown {
    const computed = PriceBreakdown.of(parts);
    if (!computed.total.equals(parts.total)) {
      throw new DomainError(
        'Totalul comenzii nu corespunde subtotalului, reducerii, livrarii si TVA',
        'INVALID_ORDER',
      );
    }
    return computed;
  }

  /** Fara reduceri, livrare sau taxe: totalul este chiar subtotalul. */
  static ofSubtotal(subtotal: Money): PriceBreakdown {
    const zero = subtotal.subtract(subtotal);
    return PriceBreakdown.of({ subtotal, discount: zero, vat: zero });
  }

  /** Suma pe care se calculeaza TVA: subtotalul dupa reducere, plus costul livrarii (livrarea se taxeaza). */
  taxableAmount(): Money {
    return this.subtotal.subtract(this.discount).add(this.shipping);
  }

  withDiscount(discount: Money): PriceBreakdown {
    return PriceBreakdown.of({ ...this.parts(), discount });
  }

  withShipping(shipping: Money): PriceBreakdown {
    return PriceBreakdown.of({ ...this.parts(), shipping });
  }

  withVat(vat: Money): PriceBreakdown {
    return PriceBreakdown.of({ ...this.parts(), vat });
  }

  private parts(): Required<PriceBreakdownParts> {
    return {
      subtotal: this.subtotal,
      discount: this.discount,
      shipping: this.shipping,
      vat: this.vat,
    };
  }
}
