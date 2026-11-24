import type { PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { MAX_STOCK } from '../../../catalog/domain/Product';
import type { StockDeduction } from '../../ports/out/OrderPlacement';
import type { StockRestoration } from '../../ports/out/StockRestoration';

/**
 * Adaptor Prisma/PostgreSQL pentru `StockRestoration`. Marcarea comenzii (`order_stock_restorations`,
 * cheie primara pe `order_id`) si cresterea stocului ruleaza in aceeasi tranzactie: doua procesari
 * concurente ale aceleiasi anulari se serializeaza pe cheia primara, iar a doua nu mai repune nimic.
 */
export class PrismaStockRestoration implements StockRestoration {
  /** @param onStockChanged apelat dupa repunere cu produsele modificate (invalidarea cache-ului de produse). */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onStockChanged: (productIds: readonly string[]) => void = () => undefined,
  ) {}

  async restore(orderId: string, stock: readonly StockDeduction[]): Promise<boolean> {
    // Aceeasi ordine fixa de blocare ca la plasare, ca tranzactiile concurente sa nu produca deadlock.
    const additions = [...stock].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const restored = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.orderStockRestoration.createMany({
        data: [{ orderId }],
        skipDuplicates: true,
      });
      if (count === 0) return false;

      for (const { productId, quantity } of additions) {
        // Stocul nu depaseste MAX_STOCK (altfel produsul ar deveni ilizibil in domeniu); un produs sters nu se modifica.
        const { count: added } = await tx.product.updateMany({
          where: { id: productId, stock: { lte: MAX_STOCK - quantity } },
          data: { stock: { increment: quantity } },
        });
        if (added === 0) {
          await tx.product.updateMany({
            where: { id: productId, stock: { gt: MAX_STOCK - quantity } },
            data: { stock: MAX_STOCK },
          });
        }
      }
      return true;
    });
    if (restored) this.onStockChanged(additions.map(({ productId }) => productId));
    return restored;
  }
}
