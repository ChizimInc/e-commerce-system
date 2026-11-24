import { DomainError, type Principal } from '../../../shared';
import { DELIVERY_METHODS } from '../domain/ShippingTypes';
import type {
  CartShippingQuote,
  QuoteShippingUseCase,
  ShippingCostQuotes,
} from '../ports/in/ShippingUseCases';
import type { QuotableCart } from '../ports/out/QuotableCart';
import type { CourierDirectory } from './CourierDirectory';

/**
 * Cotatia livrarii inainte de checkout: costul fiecarei metode pentru cosul curent. Foloseste aceleasi strategii
 * ca totalul comenzii, deci suma afisata aici e cea pe care o va plati clientul (la aceeasi componenta a cosului).
 */
export class QuoteCartShipping implements QuoteShippingUseCase {
  constructor(
    private readonly cart: QuotableCart,
    private readonly costs: ShippingCostQuotes,
    private readonly couriers: CourierDirectory,
  ) {}

  async quoteCart(principal: Principal): Promise<CartShippingQuote> {
    const basis = await this.cart.basisOf(principal.userId);
    if (basis.units < 1) throw new DomainError('Cosul este gol', 'CART_EMPTY');
    return {
      itemsValue: basis.itemsValue,
      units: basis.units,
      options: DELIVERY_METHODS.map((deliveryMethod) => ({
        deliveryMethod,
        courier: this.couriers.courierFor(deliveryMethod),
        cost: this.costs.quote(deliveryMethod, basis),
      })),
    };
  }
}
