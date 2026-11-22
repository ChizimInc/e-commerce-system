import type { PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { Cart } from '../../domain/Cart';
import type { CartRepository } from '../../ports/out/CartRepository';

/** Adaptor Prisma/PostgreSQL pentru `CartRepository` (tabelele `carts` + `cart_items`). */
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<Cart | null> {
    const row = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!row) return null;
    return Cart.restore({
      id: row.id,
      userId: row.userId,
      items: row.items.map(({ itemId, quantity }) => ({ itemId, quantity })),
    });
  }

  async save(cart: Cart): Promise<void> {
    await orConflict(
      () =>
        // O singura tranzactie: cosul si articolele lui se inlocuiesc impreuna sau deloc.
        this.prisma.$transaction(async (tx) => {
          // Folosim id-ul cosului din baza de date: daca o cerere concurenta a creat deja cosul
          // utilizatorului, id-ul generat de noi nu mai e valid (altfel articolele ar incalca FK).
          const row = await tx.cart.upsert({
            where: { userId: cart.userId },
            create: { id: cart.id, userId: cart.userId },
            update: {},
          });
          await tx.cartItem.deleteMany({ where: { cartId: row.id } });
          await tx.cartItem.createMany({
            data: cart.items.map(({ itemId, quantity }, position) => ({
              cartId: row.id,
              itemId,
              quantity,
              position,
            })),
          });
        }),
      'Cosul a fost modificat simultan, reincearca',
      'CART_CONFLICT',
    );
  }
}
