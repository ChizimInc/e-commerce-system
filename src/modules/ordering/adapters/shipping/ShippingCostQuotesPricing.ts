import type { Money } from '../../../../shared';
import type { ShippingCostQuotes } from '../../../shipping/ports/in/ShippingUseCases';
import type { ShippingPricing, ShippingPricingRequest } from '../../domain/pricing/ShippingPricing';

// Pattern: Adapter (Structural) – anti-corruption layer: aduce costul din `shipping` (ShippingCostQuotes) la portul ShippingPricing al domeniului `ordering`
/**
 * Anti-corruption layer: `ordering` isi afla costul livrarii prin portul de intrare al modulului `shipping` (strategia
 * metodei alese), fara sa stie cum se calculeaza. Compilatorul refuza asignarea metodei de livrare daca listele diverg.
 */
export class ShippingCostQuotesPricing implements ShippingPricing {
  constructor(private readonly quotes: ShippingCostQuotes) {}

  costFor({ deliveryMethod, itemsValue, units }: ShippingPricingRequest): Money {
    return this.quotes.quote(deliveryMethod, { itemsValue, units });
  }
}
