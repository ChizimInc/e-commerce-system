import type { PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { ConflictError } from '../../../../shared';
import type { OrderPlacement, OrderPlacementRequest } from '../../ports/out/OrderPlacement';
import { toOrderCreateInput } from './PrismaOrderRepository';

/**
 * Adaptor Prisma/PostgreSQL pentru `OrderPlacement`: stocul, comanda si cosul se modifica intr-o
 * singura tranzactie. Scaderea stocului este conditionata (`stock >= cantitate`), deci doua comenzi
 * concurente nu pot duce stocul sub zero. Modulele `catalog` si `cart` ruleaza in acelasi monolit si
 * aceeasi baza de date, de aceea poate atinge tabelele lor, dar doar prin aceasta tranzactie.
 */
export class PrismaOrderPlacement implements OrderPlacement {
  /**
   * @param onStockChanged apelat dupa tranzactie cu produsele al caror stoc s-a modificat
   * (ex. pentru invalidarea cache-ului de produse, care altfel ar servi stocuri invechite).
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onStockChanged: (productIds: readonly string[]) => void = () => undefined,
  ) {}

  async place({ order, stock, cartLines }: OrderPlacementRequest): Promise<void> {
    // Produsele se blocheaza mereu in aceeasi ordine, ca doua comenzi concurente sa nu produca deadlock.
    const deductions = [...stock].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    try {
      await orConflict(
        () =>
          this.prisma.$transaction(async (tx) => {
            for (const { productId, quantity } of deductions) {
              const { count } = await tx.product.updateMany({
                where: { id: productId, stock: { gte: quantity } },
                data: { stock: { decrement: quantity } },
              });
              if (count === 0) {
                throw new ConflictError(
                  `Stoc insuficient pentru produsul ${productId}`,
                  'INSUFFICIENT_STOCK',
                );
              }
            }

            await tx.order.create({ data: toOrderCreateInput(order) });

            // Stergem exact liniile comandate; daca cosul s-a schimbat (sau a fost deja consumat de o
            // cerere paralela), numarul de linii sterse difera si toata tranzactia se anuleaza.
            const cart = await tx.cart.findUnique({
              where: { userId: order.customerId },
              select: { id: true },
            });
            const { count: removed } = cart
              ? await tx.cartItem.deleteMany({
                  where: {
                    cartId: cart.id,
                    OR: cartLines.map(({ itemId, quantity }) => ({ itemId, quantity })),
                  },
                })
              : { count: 0 };
            if (removed !== cartLines.length) {
              throw new ConflictError('Cosul s-a modificat intre timp, reincearca', 'CART_CHANGED');
            }
          }),
        'Comanda nu a putut fi plasata, reincearca',
        'ORDER_CONFLICT',
      );
    } finally {
      this.onStockChanged(deductions.map(({ productId }) => productId));
    }
  }
}
