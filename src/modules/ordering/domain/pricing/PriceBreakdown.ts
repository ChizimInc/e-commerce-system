import { DomainError, type Money } from '../../../../shared';
import { MAX_AMOUNT_CENTS } from '../OrderItem';

export interface PriceBreakdownParts {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly vat: Money;
}

/**
 * Rezultatul calculului de pret al unei comenzi, in cenți (`Money`):
 * `total = subtotal - discount + vat` (TVA se aplica pe subtotalul redus). Imutabil.
 * Fiecare suma trebuie sa incapa intr-un INTEGER PostgreSQL, deci un calcul care depaseste limita
 * (de ex. TVA adaugat la un subtotal aproape de maxim) e refuzat aici, cu eroare de domeniu, nu in baza de date.
 */
export class PriceBreakdown {
  private constructor(
    readonly subtotal: Money,
    readonly discount: Money,
    readonly vat: Money,
    readonly total: Money,
  ) {
    // Partile se verifica inainte de total, ca mesajul sa arate cauza (o parte negativa, nu un total negativ).
    PriceBreakdown.assertAmount('Subtotalul', subtotal);
    PriceBreakdown.assertAmount('Reducerea', discount);
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
  static of({ subtotal, discount, vat }: PriceBreakdownParts): PriceBreakdown {
    return new PriceBreakdown(subtotal, discount, vat, subtotal.subtract(discount).add(vat));
  }

  /** Reconstruieste din valori salvate; un total care nu corespunde partilor indica date corupte. */
  static restore(parts: PriceBreakdownParts & { readonly total: Money }): PriceBreakdown {
    const computed = PriceBreakdown.of(parts);
    if (!computed.total.equals(parts.total)) {
      throw new DomainError(
        'Totalul comenzii nu corespunde subtotalului, reducerii si TVA',
        'INVALID_ORDER',
      );
    }
    return computed;
  }

  /** Fara reduceri sau taxe: totalul este chiar subtotalul. */
  static ofSubtotal(subtotal: Money): PriceBreakdown {
    const zero = subtotal.subtract(subtotal);
    return PriceBreakdown.of({ subtotal, discount: zero, vat: zero });
  }

  /** Suma pe care se calculeaza TVA: subtotalul dupa reducere. */
  taxableAmount(): Money {
    return this.subtotal.subtract(this.discount);
  }

  withDiscount(discount: Money): PriceBreakdown {
    return PriceBreakdown.of({ subtotal: this.subtotal, discount, vat: this.vat });
  }

  withVat(vat: Money): PriceBreakdown {
    return PriceBreakdown.of({ subtotal: this.subtotal, discount: this.discount, vat });
  }
}
