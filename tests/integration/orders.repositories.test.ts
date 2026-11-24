import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { InMemoryCartRepository } from '../../src/modules/cart/adapters/persistence/InMemoryCartRepository';
import { PrismaCartRepository } from '../../src/modules/cart/adapters/persistence/PrismaCartRepository';
import { Cart } from '../../src/modules/cart/domain/Cart';
import type { CartRepository } from '../../src/modules/cart/ports/out/CartRepository';
import { InMemoryProductRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryProductRepository';
import { PrismaProductRepository } from '../../src/modules/catalog/adapters/persistence/PrismaProductRepository';
import type { ProductRepository } from '../../src/modules/catalog/ports/out/ProductRepository';
import { InMemoryUserRepository } from '../../src/modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from '../../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { Email } from '../../src/modules/identity/domain/Email';
import { User } from '../../src/modules/identity/domain/User';
import type { UserRepository } from '../../src/modules/identity/ports/out/UserRepository';
import { InMemoryOrderPlacement } from '../../src/modules/ordering/adapters/persistence/InMemoryOrderPlacement';
import { InMemoryOrderRepository } from '../../src/modules/ordering/adapters/persistence/InMemoryOrderRepository';
import { PrismaOrderPlacement } from '../../src/modules/ordering/adapters/persistence/PrismaOrderPlacement';
import { PrismaOrderRepository } from '../../src/modules/ordering/adapters/persistence/PrismaOrderRepository';
import type { Order } from '../../src/modules/ordering/domain/Order';
import { OrderBuilder } from '../../src/modules/ordering/domain/OrderBuilder';
import type { OrderPlacement } from '../../src/modules/ordering/ports/out/OrderPlacement';
import type { OrderRepository } from '../../src/modules/ordering/ports/out/OrderRepository';
import { ConflictError, Money, NotFoundError } from '../../src/shared';
import { makeProduct } from '../helpers/catalog-fixtures';
import { makeAddress } from '../helpers/order-fixtures';

interface Harness {
  users: UserRepository;
  products: ProductRepository;
  carts: CartRepository;
  orders: OrderRepository;
  placement: OrderPlacement;
  /** Sterge datele create de test (comenzi, utilizatori + cosuri, produse). */
  cleanup: (ids: { userIds: string[]; productIds: string[] }) => Promise<void>;
}

/** Contractul `OrderRepository` si `OrderPlacement`, rulat pe fiecare adaptor (in-memory si PostgreSQL). */
function contract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository-uri ordering: ${name}`, () => {
    const { users, products, carts, orders, placement, cleanup } = create();
    const tag = randomUUID().slice(0, 8);
    const userIds: string[] = [];
    const productIds: string[] = [];

    afterAll(() => cleanup({ userIds, productIds }));

    const newUser = async (label: string): Promise<string> => {
      const user = new User({
        id: randomUUID(),
        email: Email.of(`${label}.${tag}@test.local`),
        passwordHash: '$2b$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        role: 'CUSTOMER',
        createdAt: new Date(),
      });
      await users.save(user);
      userIds.push(user.id);
      return user.id;
    };

    const newProduct = async (stock: number, amount = 10_000) => {
      const product = makeProduct({ id: randomUUID(), name: `Produs ${tag}`, amount, stock });
      await products.save(product);
      productIds.push(product.id);
      return product;
    };

    const buildOrder = (
      customerId: string,
      lines: { itemId: string; quantity: number; amount?: number }[],
      createdAt = new Date('2026-01-02T03:04:05.000Z'),
    ): Order =>
      OrderBuilder.forOrder(randomUUID())
        .customer(customerId)
        .addItems(
          lines.map(({ itemId, quantity, amount = 10_000 }, i) => ({
            itemId,
            name: `Articol ${i + 1}`,
            unitPrice: Money.of(amount, 'RON'),
            quantity,
          })),
        )
        .shippingAddress(makeAddress())
        .delivery('EXPRESS')
        .payment('CASH_ON_DELIVERY')
        .placedAt(createdAt)
        .build();

    const stockOf = async (id: string) => (await products.findById(id))?.stock;

    describe('OrderRepository', () => {
      it('salveaza o comanda si o regaseste identica (linii in ordine, adresa, total, moduri, data)', async () => {
        const customerId = await newUser('roundtrip');
        const order = buildOrder(customerId, [
          { itemId: randomUUID(), quantity: 3, amount: 2_550 },
          { itemId: randomUUID(), quantity: 1, amount: 99 },
          { itemId: randomUUID(), quantity: 2, amount: 1_000_000 },
        ]);
        await orders.add(order);

        const loaded = await orders.findById(order.id);
        expect(loaded?.id).toBe(order.id);
        expect(loaded?.customerId).toBe(customerId);
        expect(loaded?.status).toBe('NEW');
        expect(loaded?.paidAt).toBeNull();
        expect(loaded?.deliveryMethod).toBe('EXPRESS');
        expect(loaded?.paymentMethod).toBe('CASH_ON_DELIVERY');
        expect(loaded?.address.toJSON()).toEqual(order.address.toJSON());
        expect(loaded?.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
        expect(loaded?.total.equals(order.total)).toBe(true);
        expect(
          loaded?.items.map((i) => [i.itemId, i.name, i.unitPrice.amount, i.quantity]),
        ).toEqual(order.items.map((i) => [i.itemId, i.name, i.unitPrice.amount, i.quantity]));
      });

      it('intoarce null pentru o comanda inexistenta', async () => {
        expect(await orders.findById(randomUUID())).toBeNull();
      });

      it('refuza acelasi id de doua ori cu ConflictError', async () => {
        const order = buildOrder(await newUser('dup'), [{ itemId: randomUUID(), quantity: 1 }]);
        await orders.add(order);
        await expect(orders.add(order)).rejects.toBeInstanceOf(ConflictError);
      });

      it('findByCustomerId: doar comenzile clientului, cele mai noi primele, cu paginare si total', async () => {
        const mine = await newUser('hist1');
        const other = await newUser('hist2');
        const dates = ['2026-01-01', '2026-03-01', '2026-02-01'].map(
          (d) => new Date(`${d}T10:00:00Z`),
        );
        const created: Order[] = [];
        for (const date of dates) {
          const order = buildOrder(mine, [{ itemId: randomUUID(), quantity: 1 }], date);
          await orders.add(order);
          created.push(order);
        }
        await orders.add(buildOrder(other, [{ itemId: randomUUID(), quantity: 1 }]));

        const all = await orders.findByCustomerId({ customerId: mine, limit: 10, offset: 0 });
        expect(all.total).toBe(3);
        expect(all.items.map((o) => o.id)).toEqual([
          created[1]!.id,
          created[2]!.id,
          created[0]!.id,
        ]);

        const page = await orders.findByCustomerId({ customerId: mine, limit: 1, offset: 1 });
        expect(page.total).toBe(3);
        expect(page.items.map((o) => o.id)).toEqual([created[2]!.id]);

        expect(
          (await orders.findByCustomerId({ customerId: randomUUID(), limit: 10, offset: 0 })).total,
        ).toBe(0);
      });

      it('updateStatus salveaza statusul si momentul platii; o comanda anulata dupa plata ramane rambursabila', async () => {
        const order = buildOrder(await newUser('status'), [{ itemId: randomUUID(), quantity: 1 }]);
        await orders.add(order);

        const paid = order.pay(new Date('2026-04-05T06:07:08.000Z'));
        await orders.updateStatus(paid, 'NEW');
        const loadedPaid = await orders.findById(order.id);
        expect(loadedPaid?.status).toBe('PAID');
        expect(loadedPaid?.paidAt?.toISOString()).toBe('2026-04-05T06:07:08.000Z');

        await orders.updateStatus(paid.cancel(), 'PAID');
        const loadedCancelled = await orders.findById(order.id);
        expect(loadedCancelled?.status).toBe('CANCELLED');
        expect(loadedCancelled?.paidAt).not.toBeNull();
        expect(loadedCancelled?.refund().status).toBe('REFUNDED'); // starea State reconstruita corect
      });

      it('o comanda anulata fara plata ramane nerambursabila dupa reincarcare', async () => {
        const order = buildOrder(await newUser('unpaid'), [{ itemId: randomUUID(), quantity: 1 }]);
        await orders.add(order);
        await orders.updateStatus(order.cancel(), 'NEW');
        const loaded = await orders.findById(order.id);
        expect(loaded?.status).toBe('CANCELLED');
        expect(() => loaded?.refund()).toThrowError(/CANCELLED -> REFUNDED/);
      });

      it('updateStatus cu statusul asteptat gresit: ConflictError(ORDER_CHANGED), nimic nu se schimba', async () => {
        const order = buildOrder(await newUser('stale'), [{ itemId: randomUUID(), quantity: 1 }]);
        await orders.add(order);
        await expect(orders.updateStatus(order.pay(), 'PAID')).rejects.toMatchObject({
          code: 'ORDER_CHANGED',
        });
        expect((await orders.findById(order.id))?.status).toBe('NEW');
      });

      it('updateStatus pe o comanda inexistenta: NotFoundError', async () => {
        const ghost = buildOrder(await newUser('ghost'), [{ itemId: randomUUID(), quantity: 1 }]);
        await expect(orders.updateStatus(ghost.pay(), 'NEW')).rejects.toBeInstanceOf(NotFoundError);
      });

      it('doua tranzitii simultane din aceeasi stare: exact una reuseste', async () => {
        const order = buildOrder(await newUser('race'), [{ itemId: randomUUID(), quantity: 1 }]);
        await orders.add(order);
        const results = await Promise.allSettled([
          orders.updateStatus(order.pay(), 'NEW'),
          orders.updateStatus(order.cancel(), 'NEW'),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'ORDER_CHANGED' },
        });
      });
    });

    describe('OrderPlacement (stoc + comanda + cos, atomic)', () => {
      const cartOf = async (userId: string, lines: { itemId: string; quantity: number }[]) => {
        let cart = Cart.empty(randomUUID(), userId);
        for (const { itemId, quantity } of lines) cart = cart.addItem(itemId, quantity);
        await carts.save(cart);
      };

      it('scade stocul, salveaza comanda si sterge liniile comandate din cos', async () => {
        const userId = await newUser('place1');
        const a = await newProduct(10);
        const b = await newProduct(4);
        const extra = await newProduct(9);
        await cartOf(userId, [
          { itemId: a.id, quantity: 3 },
          { itemId: b.id, quantity: 4 },
          { itemId: extra.id, quantity: 1 }, // nu face parte din comanda
        ]);
        const order = buildOrder(userId, [
          { itemId: a.id, quantity: 3 },
          { itemId: b.id, quantity: 4 },
        ]);

        await placement.place({
          order,
          stock: [
            { productId: a.id, quantity: 3 },
            { productId: b.id, quantity: 4 },
          ],
          cartLines: [
            { itemId: a.id, quantity: 3 },
            { itemId: b.id, quantity: 4 },
          ],
        });

        expect(await stockOf(a.id)).toBe(7);
        expect(await stockOf(b.id)).toBe(0);
        expect((await orders.findById(order.id))?.items).toHaveLength(2);
        expect((await carts.findByUserId(userId))?.items).toEqual([
          { itemId: extra.id, quantity: 1 },
        ]);
      });

      it('stoc insuficient la al doilea produs: nimic nu se schimba (rollback complet)', async () => {
        const userId = await newUser('place2');
        const a = await newProduct(10);
        const b = await newProduct(1);
        await cartOf(userId, [
          { itemId: a.id, quantity: 2 },
          { itemId: b.id, quantity: 1 },
        ]);
        const order = buildOrder(userId, [
          { itemId: a.id, quantity: 2 },
          { itemId: b.id, quantity: 1 },
        ]);

        await expect(
          placement.place({
            order,
            stock: [
              { productId: a.id, quantity: 2 },
              { productId: b.id, quantity: 5 }, // doar 1 in stoc
            ],
            cartLines: [
              { itemId: a.id, quantity: 2 },
              { itemId: b.id, quantity: 1 },
            ],
          }),
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

        expect(await stockOf(a.id)).toBe(10);
        expect(await stockOf(b.id)).toBe(1);
        expect(await orders.findById(order.id)).toBeNull();
        expect((await carts.findByUserId(userId))?.items).toHaveLength(2);
      });

      it('cosul modificat intre timp: CART_CHANGED, stocul si comanda raman neatinse', async () => {
        const userId = await newUser('place3');
        const a = await newProduct(10);
        await cartOf(userId, [{ itemId: a.id, quantity: 5 }]); // comanda a fost calculata pentru 2
        const order = buildOrder(userId, [{ itemId: a.id, quantity: 2 }]);

        await expect(
          placement.place({
            order,
            stock: [{ productId: a.id, quantity: 2 }],
            cartLines: [{ itemId: a.id, quantity: 2 }],
          }),
        ).rejects.toMatchObject({ code: 'CART_CHANGED' });

        expect(await stockOf(a.id)).toBe(10);
        expect(await orders.findById(order.id)).toBeNull();
        expect((await carts.findByUserId(userId))?.items).toEqual([{ itemId: a.id, quantity: 5 }]);
      });

      it('utilizator fara cos: CART_CHANGED', async () => {
        const userId = await newUser('place4');
        const a = await newProduct(10);
        await expect(
          placement.place({
            order: buildOrder(userId, [{ itemId: a.id, quantity: 1 }]),
            stock: [{ productId: a.id, quantity: 1 }],
            cartLines: [{ itemId: a.id, quantity: 1 }],
          }),
        ).rejects.toMatchObject({ code: 'CART_CHANGED' });
        expect(await stockOf(a.id)).toBe(10);
      });

      it('doua comenzi concurente pentru ultima bucata: una reuseste, stocul nu devine negativ', async () => {
        const first = await newUser('race1');
        const second = await newUser('race2');
        const last = await newProduct(1);
        await cartOf(first, [{ itemId: last.id, quantity: 1 }]);
        await cartOf(second, [{ itemId: last.id, quantity: 1 }]);
        const place = (userId: string) =>
          placement.place({
            order: buildOrder(userId, [{ itemId: last.id, quantity: 1 }]),
            stock: [{ productId: last.id, quantity: 1 }],
            cartLines: [{ itemId: last.id, quantity: 1 }],
          });

        const results = await Promise.allSettled([place(first), place(second)]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'INSUFFICIENT_STOCK' },
        });
        expect(await stockOf(last.id)).toBe(0);
        const counts = await Promise.all(
          [first, second].map((id) =>
            orders.findByCustomerId({ customerId: id, limit: 10, offset: 0 }),
          ),
        );
        expect(counts.map((c) => c.total).sort()).toEqual([0, 1]);
      });

      it('dubla trimitere a aceluiasi cos: o singura comanda, stoc scazut o data', async () => {
        const userId = await newUser('double');
        const a = await newProduct(10);
        await cartOf(userId, [{ itemId: a.id, quantity: 2 }]);
        const place = () =>
          placement.place({
            order: buildOrder(userId, [{ itemId: a.id, quantity: 2 }]),
            stock: [{ productId: a.id, quantity: 2 }],
            cartLines: [{ itemId: a.id, quantity: 2 }],
          });

        const results = await Promise.allSettled([place(), place()]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'CART_CHANGED' },
        });
        expect(await stockOf(a.id)).toBe(8);
        expect(
          (await orders.findByCustomerId({ customerId: userId, limit: 10, offset: 0 })).total,
        ).toBe(1);
      });
    });
  });
}

contract('in-memory', () => {
  const products = new InMemoryProductRepository();
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  return {
    users: new InMemoryUserRepository(),
    products,
    carts,
    orders,
    placement: new InMemoryOrderPlacement(orders, products, carts),
    cleanup: () => Promise.resolve(),
  };
});

const databaseUrl = process.env['DATABASE_URL'];

contract(
  'Prisma/PostgreSQL',
  () => {
    const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
    return {
      users: new PrismaUserRepository(prisma),
      products: new PrismaProductRepository(prisma),
      carts: new PrismaCartRepository(prisma),
      orders: new PrismaOrderRepository(prisma),
      placement: new PrismaOrderPlacement(prisma),
      cleanup: async ({ userIds, productIds }) => {
        // Comenzile refera utilizatorii cu ON DELETE RESTRICT: se sterg primele (liniile dispar in cascada).
        await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } }); // cosurile dispar in cascada
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        await prisma.$disconnect();
      },
    };
  },
  Boolean(databaseUrl),
);
