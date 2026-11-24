import { ConflictError } from '../../../../shared';
import type { CartRepository } from '../../../cart/ports/out/CartRepository';
import type { ProductRepository } from '../../../catalog/ports/out/ProductRepository';
import type { OrderPlacement, OrderPlacementRequest } from '../../ports/out/OrderPlacement';
import type { OrderRepository } from '../../ports/out/OrderRepository';

/**
 * Adaptor in-memory pentru `OrderPlacement`: aceeasi regula ca in PostgreSQL (totul sau nimic).
 * Plasarile ruleaza una dupa alta (coada de promisiuni), iar toate verificarile se fac inainte de prima scriere.
 */
export class InMemoryOrderPlacement implements OrderPlacement {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductRepository,
    private readonly carts: CartRepository,
  ) {}

  place(request: OrderPlacementRequest): Promise<void> {
    const run = this.queue.then(() => this.apply(request));
    this.queue = run.catch(() => undefined); // o plasare esuata nu blocheaza coada
    return run;
  }

  private async apply({ order, stock, cartLines }: OrderPlacementRequest): Promise<void> {
    const cart = await this.carts.findByUserId(order.customerId);
    const untouched = cartLines.every((line) => cart?.quantityOf(line.itemId) === line.quantity);
    if (!cart || !untouched) {
      throw new ConflictError('Cosul s-a modificat intre timp, reincearca', 'CART_CHANGED');
    }

    const products = new Map(
      (await this.products.findByIds(stock.map((s) => s.productId))).map((p) => [p.id, p]),
    );
    const updates = stock.map(({ productId, quantity }) => {
      const product = products.get(productId);
      if (!product || product.stock < quantity) {
        throw new ConflictError(
          `Stoc insuficient pentru "${product?.name ?? productId}"`,
          'INSUFFICIENT_STOCK',
        );
      }
      return product.withChanges({ stock: product.stock - quantity });
    });

    // Comanda se adauga prima: daca id-ul exista deja, arunca inainte sa se scrie stocul sau cosul.
    // Dupa ea nu mai poate esua nicio verificare, deci aplicam restul scrierilor.
    await this.orders.add(order);
    for (const product of updates) await this.products.save(product);
    await this.carts.save(
      cartLines.reduce((current, line) => current.removeItem(line.itemId), cart),
    );
  }
}
