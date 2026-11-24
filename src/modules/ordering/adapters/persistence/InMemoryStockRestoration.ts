import { MAX_STOCK, type Product } from '../../../catalog/domain/Product';
import type { ProductRepository } from '../../../catalog/ports/out/ProductRepository';
import type { StockDeduction } from '../../ports/out/OrderPlacement';
import type { StockRestoration } from '../../ports/out/StockRestoration';

/**
 * Adaptor in-memory pentru `StockRestoration`: aceeasi regula ca in PostgreSQL (o singura repunere per comanda).
 * Comanda se marcheaza INAINTE de prima `await`, deci doua procesari concurente ale aceleiasi anulari nu pot trece amandoua.
 */
export class InMemoryStockRestoration implements StockRestoration {
  private readonly restored = new Set<string>();

  constructor(private readonly products: ProductRepository) {}

  async restore(orderId: string, stock: readonly StockDeduction[]): Promise<boolean> {
    if (this.restored.has(orderId)) return false;
    this.restored.add(orderId);
    const saved: Product[] = []; // starile de dinainte, pentru anulare daca repunerea esueaza la mijloc
    try {
      const found = new Map(
        (await this.products.findByIds(stock.map((s) => s.productId))).map((p) => [p.id, p]),
      );
      for (const { productId, quantity } of stock) {
        const product = found.get(productId);
        // Un produs sters intre timp nu mai are stoc de repus.
        if (!product) continue;
        await this.products.save(
          product.withChanges({ stock: Math.min(product.stock + quantity, MAX_STOCK) }),
        );
        saved.push(product);
      }
      return true;
    } catch (error) {
      // Totul sau nimic, ca in PostgreSQL: se readuc produsele deja modificate, iar comanda ramane nemarcata.
      for (const original of saved) await this.products.save(original).catch(() => undefined);
      this.restored.delete(orderId);
      throw error;
    }
  }
}
