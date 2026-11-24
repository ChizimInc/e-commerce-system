import type { CartUseCases } from '../../../cart/ports/in/CartUseCases';
import type { CartSource } from '../../ports/out/CartSource';
import type { ConsumedCartLine } from '../../ports/out/OrderPlacement';

/** Anti-corruption layer: comanda isi citeste articolele prin portul de intrare al modulului `cart`. */
export class CartServiceSource implements CartSource {
  constructor(private readonly carts: CartUseCases) {}

  async linesOf(userId: string): Promise<readonly ConsumedCartLine[]> {
    const cart = await this.carts.getCart(userId);
    return cart.lines.map(({ itemId, quantity }) => ({ itemId, quantity }));
  }
}
