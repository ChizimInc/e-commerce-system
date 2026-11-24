import type { OrderItem } from '../OrderItem';
import {
  BasePrice,
  DiscountDecorator,
  VatDecorator,
  type DiscountTier,
  type PriceCalculator,
} from './PriceCalculator';

/** Regulile de pret ale magazinului; vin din configurare (composition root), nu sunt hardcodate in domeniu. */
export interface PricingPolicy {
  /** Cota TVA, in procente (0 = fara TVA). */
  readonly vatPercent: number;
  /** Praguri de reducere dupa subtotal (lista goala = fara reduceri). */
  readonly discountTiers: readonly DiscountTier[];
}

/** Fara reduceri si fara TVA: totalul este suma liniilor. */
export const NO_PRICE_MODIFIERS: PricingPolicy = { vatPercent: 0, discountTiers: [] };

/**
 * Asambleaza calculatorul comenzii: `BasePrice` -> reducere -> (livrare expres, Iteratia 5) -> TVA.
 * Ordinea conteaza: TVA se aplica dupa reducere, iar un cost de livrare (care se taxeaza) se va insera inaintea TVA.
 */
export function priceCalculatorFor(
  items: readonly OrderItem[],
  policy: PricingPolicy,
): PriceCalculator {
  let calculator: PriceCalculator = new BasePrice(items);
  if (policy.discountTiers.length > 0) {
    calculator = new DiscountDecorator(calculator, policy.discountTiers);
  }
  // Loc pregatit pentru `ExpressShippingDecorator` (cost dupa metoda de livrare, Strategy B1, Iteratia 5).
  if (policy.vatPercent > 0) {
    calculator = new VatDecorator(calculator, policy.vatPercent);
  }
  return calculator;
}
