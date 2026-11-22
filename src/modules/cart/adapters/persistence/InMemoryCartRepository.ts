import type { Cart } from '../../domain/Cart';
import type { CartRepository } from '../../ports/out/CartRepository';

/** Adaptor in-memory pentru `CartRepository`. Cosurile sunt imutabile, deci se pot pastra direct. */
export class InMemoryCartRepository implements CartRepository {
  private readonly byUser = new Map<string, Cart>();

  findByUserId(userId: string): Promise<Cart | null> {
    return Promise.resolve(this.byUser.get(userId) ?? null);
  }

  save(cart: Cart): Promise<void> {
    this.byUser.set(cart.userId, cart);
    return Promise.resolve();
  }
}
