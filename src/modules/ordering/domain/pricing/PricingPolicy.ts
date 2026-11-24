import type { OrderItem } from '../OrderItem';
import type { DeliveryMethod } from '../OrderTypes';
import {
  BasePrice,
  DiscountDecorator,
  ShippingDecorator,
  VatDecorator,
  type DiscountTier,
  type PriceCalculator,
} from './PriceCalculator';
import type { ShippingPricing } from './ShippingPricing';

/** Regulile de pret ale magazinului; vin din configurare (composition root), nu sunt hardcodate in domeniu. */
export interface PricingPolicy {
  /** Cota TVA, in procente (0 = fara TVA). */
  readonly vatPercent: number;
  /** Praguri de reducere dupa subtotal (lista goala = fara reduceri). */
  readonly discountTiers: readonly DiscountTier[];
  /** Costul livrarii dupa metoda aleasa; lipsa = livrare gratuita (teste si demo fara modulul `shipping`). */
  readonly shipping?: ShippingPricing;
}

/** Fara reduceri, livrare si TVA: totalul este suma liniilor. */
export const NO_PRICE_MODIFIERS: PricingPolicy = { vatPercent: 0, discountTiers: [] };

/**
 * Asambleaza calculatorul comenzii: `BasePrice` -> reducere -> livrare -> TVA.
 * Ordinea conteaza: TVA se aplica dupa reducere, iar costul livrarii (care se taxeaza) se adauga inaintea TVA.
 */
export function priceCalculatorFor(
  items: readonly OrderItem[],
  policy: PricingPolicy,
  deliveryMethod: DeliveryMethod,
): PriceCalculator {
  let calculator: PriceCalculator = new BasePrice(items);
  if (policy.discountTiers.length > 0) {
    calculator = new DiscountDecorator(calculator, policy.discountTiers);
  }
  if (policy.shipping) {
    const units = items.reduce((count, item) => count + item.quantity, 0);
    calculator = new ShippingDecorator(calculator, policy.shipping, {
      method: deliveryMethod,
      units,
    });
  }
  if (policy.vatPercent > 0) {
    calculator = new VatDecorator(calculator, policy.vatPercent);
  }
  return calculator;
}
