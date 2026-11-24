import type { CartUseCases } from '../../../cart/ports/in/CartUseCases';
import type { CartQuoteBasis, QuotableCart } from '../../ports/out/QuotableCart';

// Pattern: Adapter (Structural) – anti-corruption layer: aduce cosul din `cart` (CartUseCases) la portul QuotableCart al modulului `shipping`
/** Anti-corruption layer: cotatia de livrare citeste cosul prin portul de intrare al modulului `cart`. */
export class CartUseCasesQuotableCart implements QuotableCart {
  constructor(private readonly carts: CartUseCases) {}

  async basisOf(userId: string): Promise<CartQuoteBasis> {
    const cart = await this.carts.getCart(userId);
    return { itemsValue: cart.total, units: cart.itemCount };
  }
}
