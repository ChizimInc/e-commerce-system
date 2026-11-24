import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { PrismaCartRepository } from '../../src/modules/cart/adapters/persistence/PrismaCartRepository';
import { Cart } from '../../src/modules/cart/domain/Cart';
import { PrismaProductRepository } from '../../src/modules/catalog/adapters/persistence/PrismaProductRepository';
import { PrismaUserRepository } from '../../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { Email } from '../../src/modules/identity/domain/Email';
import { User } from '../../src/modules/identity/domain/User';
import { PrismaOrderPlacement } from '../../src/modules/ordering/adapters/persistence/PrismaOrderPlacement';
import { PrismaOrderRepository } from '../../src/modules/ordering/adapters/persistence/PrismaOrderRepository';
import { PrismaStockRestoration } from '../../src/modules/ordering/adapters/persistence/PrismaStockRestoration';
import { OrderBuilder } from '../../src/modules/ordering/domain/OrderBuilder';
import { NO_PRICE_MODIFIERS } from '../../src/modules/ordering/domain/pricing/PricingPolicy';
import { Money } from '../../src/shared';
import { makeProduct } from '../helpers/catalog-fixtures';
import { makeAddress } from '../helpers/order-fixtures';

// Garantii specifice PostgreSQL ale plasarii: ordinea de blocare si invalidarea cache-ului.
// Sarit fara DATABASE_URL.
const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('PrismaOrderPlacement (PostgreSQL)', () => {
  const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
  const users = new PrismaUserRepository(prisma);
  const products = new PrismaProductRepository(prisma);
  const carts = new PrismaCartRepository(prisma);
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const productIds: string[] = [];

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.$disconnect();
  });

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

  const newProduct = async (stock: number): Promise<string> => {
    const product = makeProduct({ id: randomUUID(), name: `Produs ${tag}`, stock });
    await products.save(product);
    productIds.push(product.id);
    return product.id;
  };

  /** Pregateste cosul si cererea de plasare pentru un utilizator, cu produsele in ordinea data. */
  const prepare = async (userId: string, ids: string[]) => {
    let cart = Cart.empty(randomUUID(), userId);
    for (const id of ids) cart = cart.addItem(id, 1);
    await carts.save(cart);
    const order = OrderBuilder.forOrder(randomUUID())
      .customer(userId)
      .addItems(
        ids.map((itemId) => ({
          itemId,
          name: 'Articol',
          unitPrice: Money.of(100, 'RON'),
          quantity: 1,
        })),
      )
      .shippingAddress(makeAddress())
      .delivery('STANDARD')
      .payment('CARD')
      .pricing(NO_PRICE_MODIFIERS)
      .build();
    return {
      order,
      stock: ids.map((productId) => ({ productId, quantity: 1 })),
      cartLines: ids.map((itemId) => ({ itemId, quantity: 1 })),
    };
  };

  it('produsele se blocheaza intr-o ordine fixa: comenzi concurente cu produse in ordine opusa nu produc deadlock', async () => {
    const placement = new PrismaOrderPlacement(prisma);
    for (let round = 0; round < 20; round++) {
      const a = await newProduct(1);
      const b = await newProduct(1);
      const first = await prepare(await newUser(`lock-a-${round}`), [a, b]);
      const second = await prepare(await newUser(`lock-b-${round}`), [b, a]); // ordine opusa

      const results = await Promise.allSettled([placement.place(first), placement.place(second)]);

      // Fara sortare, una dintre tranzactii ar muri cu deadlock (o eroare care nu e ConflictError).
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
        }
      }
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  }, 60_000);

  it('anunta produsele modificate (sortate) dupa succes, ca proxy-ul cu cache sa isi invalideze intrarile', async () => {
    const calls: (readonly string[])[] = [];
    const placement = new PrismaOrderPlacement(prisma, (ids) => calls.push(ids));
    const a = await newProduct(5);
    const b = await newProduct(5);
    await placement.place(await prepare(await newUser('spy-ok'), [b, a]));

    expect(calls).toEqual([[a, b].sort()]);
  });

  it('anunta produsele si cand plasarea esueaza (rezultatul unei scrieri esuate nu lasa cache vechi)', async () => {
    const calls: (readonly string[])[] = [];
    const placement = new PrismaOrderPlacement(prisma, (ids) => calls.push(ids));
    const a = await newProduct(0); // fara stoc
    await expect(
      placement.place(await prepare(await newUser('spy-fail'), [a])),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(calls).toEqual([[a]]);
  });

  it('anuntarea stocului repus: produsele modificate (sortate) doar cand repunerea se aplica; a doua oara nu anunta nimic', async () => {
    const calls: (readonly string[])[] = [];
    const restoration = new PrismaStockRestoration(prisma, (ids) => calls.push(ids));
    const a = await newProduct(5);
    const b = await newProduct(5);
    const prepared = await prepare(await newUser('restore-spy'), [b, a]);
    await new PrismaOrderRepository(prisma).add(prepared.order);

    expect(await restoration.restore(prepared.order.id, prepared.stock)).toBe(true);
    expect(await restoration.restore(prepared.order.id, prepared.stock)).toBe(false);

    expect(calls).toEqual([[a, b].sort()]);
    expect(
      await prisma.orderStockRestoration.count({ where: { orderId: prepared.order.id } }),
    ).toBe(1);
  });

  it('repunerea esuata (comanda inexistenta) nu schimba stocul si nu marcheaza nimic', async () => {
    const restoration = new PrismaStockRestoration(prisma);
    const a = await newProduct(5);
    await expect(
      restoration.restore(randomUUID(), [{ productId: a, quantity: 3 }]),
    ).rejects.toBeDefined();
    expect((await products.findById(a))?.stock).toBe(5); // tranzactia s-a anulat
  });

  it('baza de date refuza un pret inconsistent (total != subtotal - reducere + TVA) si o reducere peste subtotal', async () => {
    const customerId = await newUser('check');
    const row = {
      customerId,
      currency: 'RON' as const,
      deliveryMethod: 'STANDARD' as const,
      paymentMethod: 'CARD' as const,
      shippingRecipient: 'A',
      shippingStreet: 'B',
      shippingCity: 'C',
      shippingPostalCode: 'D',
      shippingCountry: 'MD',
    };
    await expect(
      prisma.order.create({
        data: {
          id: randomUUID(),
          ...row,
          subtotalAmount: 1000,
          discountAmount: 100,
          vatAmount: 171,
          totalAmount: 1000,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.order.create({
        data: {
          id: randomUUID(),
          ...row,
          subtotalAmount: 100,
          discountAmount: 200,
          vatAmount: 0,
          totalAmount: -100,
        },
      }),
    ).rejects.toBeDefined();
    const ok = await prisma.order.create({
      data: {
        id: randomUUID(),
        ...row,
        subtotalAmount: 1000,
        discountAmount: 100,
        vatAmount: 171,
        totalAmount: 1071,
      },
    });
    expect(ok.totalAmount).toBe(1071);
  });
});
