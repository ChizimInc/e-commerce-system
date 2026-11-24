import type { OrderableItem } from '../ports/out/OrderCatalog';
import type { StockDeduction } from '../ports/out/OrderPlacement';

/**
 * Stocul pe produse simple pentru o lista de (articol, cantitate): un pachet consuma stocul
 * componentelor, iar acelasi produs poate aparea in mai multe linii (singur si in pachete), deci
 * cantitatile se aduna pe produs. Folosit atat la scaderea stocului (plasare), cat si la repunerea lui (anulare).
 */
export function aggregateStock(
  lines: readonly { item: Pick<OrderableItem, 'stockPerUnit'>; quantity: number }[],
): StockDeduction[] {
  const byProduct = new Map<string, number>();
  for (const { item, quantity } of lines) {
    for (const part of item.stockPerUnit) {
      byProduct.set(
        part.productId,
        (byProduct.get(part.productId) ?? 0) + part.quantity * quantity,
      );
    }
  }
  return [...byProduct].map(([productId, quantity]) => ({ productId, quantity }));
}
