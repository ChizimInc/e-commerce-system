import { DomainError } from '../../../../shared';
import type { OrderItem } from '../OrderItem';
import type { DeliveryMethod } from '../OrderTypes';
import { PriceBreakdown } from './PriceBreakdown';
import type { ShippingPricing } from './ShippingPricing';

/** Componenta comuna: orice calculator de pret (de baza sau decorat) produce un `PriceBreakdown`. */
export interface PriceCalculator {
  calculate(): PriceBreakdown;
}

// Pattern: Decorator (Structural) – componenta concreta: pretul de baza (suma liniilor), peste care se infasoara decoratorii
export class BasePrice implements PriceCalculator {
  constructor(private readonly items: readonly OrderItem[]) {}

  calculate(): PriceBreakdown {
    const [first, ...rest] = this.items;
    if (!first) {
      throw new DomainError('Comanda trebuie sa contina cel putin un articol', 'INVALID_ORDER');
    }
    // `Money` refuza moneda diferita intre linii.
    return PriceBreakdown.ofSubtotal(
      rest.reduce((sum, item) => sum.add(item.lineTotal()), first.lineTotal()),
    );
  }
}

// Pattern: Decorator (Structural) – decoratorul de baza: implementeaza aceeasi interfata, delega calculatorului infasurat si ii ajusteaza rezultatul
export abstract class PriceDecorator implements PriceCalculator {
  constructor(protected readonly inner: PriceCalculator) {}

  calculate(): PriceBreakdown {
    return this.decorate(this.inner.calculate());
  }

  /** Aplica modificatorul de pret peste rezultatul calculatorului infasurat. */
  protected abstract decorate(price: PriceBreakdown): PriceBreakdown;
}

/** Un prag de reducere: de la acest subtotal (in cenți) se aplica `percent` la suta. */
export interface DiscountTier {
  readonly minSubtotalCents: number;
  readonly percent: number;
}

// Pattern: Decorator (Structural) – decorator concret: reducere procentuala dupa subtotal (se aplica cel mai mare prag atins)
export class DiscountDecorator extends PriceDecorator {
  private readonly tiers: readonly DiscountTier[];

  constructor(inner: PriceCalculator, tiers: readonly DiscountTier[]) {
    super(inner);
    for (const { minSubtotalCents, percent } of tiers) {
      if (!Number.isSafeInteger(minSubtotalCents) || minSubtotalCents < 0) {
        throw new DomainError(
          'Pragul reducerii trebuie sa fie un numar intreg >= 0',
          'INVALID_PRICING',
        );
      }
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new DomainError(
          'Reducerea trebuie sa fie intre 0 (exclusiv) si 100%',
          'INVALID_PRICING',
        );
      }
    }
    // Pragurile cele mai mari primele: primul atins este cel aplicat.
    this.tiers = [...tiers].sort((a, b) => b.minSubtotalCents - a.minSubtotalCents);
    // O comanda mai mare nu trebuie sa primeasca o reducere mai mica (nici praguri duplicate, cu rezultat ambiguu).
    this.tiers.forEach((tier, i) => {
      const bigger = this.tiers[i - 1];
      if (
        bigger &&
        (bigger.minSubtotalCents === tier.minSubtotalCents || bigger.percent <= tier.percent)
      ) {
        throw new DomainError(
          'Pragurile trebuie sa fie distincte, iar reducerea sa creasca odata cu pragul',
          'INVALID_PRICING',
        );
      }
    });
  }

  protected decorate(price: PriceBreakdown): PriceBreakdown {
    const tier = this.tiers.find(
      ({ minSubtotalCents }) => price.subtotal.amount >= minSubtotalCents,
    );
    if (!tier) return price;
    return price.withDiscount(price.subtotal.percentage(tier.percent));
  }
}

// Pattern: Decorator (Structural) – decorator concret: adauga costul livrarii, cerut portului `ShippingPricing` (strategia metodei de livrare); se aplica inaintea TVA, fiindca livrarea se taxeaza
export class ShippingDecorator extends PriceDecorator {
  constructor(
    inner: PriceCalculator,
    private readonly pricing: ShippingPricing,
    private readonly delivery: { readonly method: DeliveryMethod; readonly units: number },
  ) {
    super(inner);
  }

  protected decorate(price: PriceBreakdown): PriceBreakdown {
    return price.withShipping(
      this.pricing.costFor({
        deliveryMethod: this.delivery.method,
        itemsValue: price.subtotal,
        units: this.delivery.units,
      }),
    );
  }
}

// Pattern: Decorator (Structural) – decorator concret: TVA calculat pe subtotalul dupa reducere (preturile din catalog sunt fara TVA)
export class VatDecorator extends PriceDecorator {
  constructor(
    inner: PriceCalculator,
    private readonly ratePercent: number,
  ) {
    super(inner);
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      throw new DomainError('Cota TVA trebuie sa fie intre 0 si 100%', 'INVALID_PRICING');
    }
  }

  protected decorate(price: PriceBreakdown): PriceBreakdown {
    return price.withVat(price.taxableAmount().percentage(this.ratePercent));
  }
}
