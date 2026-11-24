import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogOrderLookup } from '../../../src/modules/ordering/adapters/catalog/CatalogOrderLookup';
import { Bundle } from '../../../src/modules/catalog/domain/Bundle';
import type { CatalogItem } from '../../../src/modules/catalog/domain/CatalogItem';
import type { CatalogQueries } from '../../../src/modules/catalog/ports/in/CatalogQueries';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { makeOrder } from '../../helpers/order-fixtures';
import { uuid } from '../../helpers/ids';
import {
  buildOrderingHarness,
  customer,
  type OrderingHarness,
} from '../../helpers/ordering-harness';

describe('InMemoryOrderPlacement (totul sau nimic)', () => {
  let h: OrderingHarness;
  const ana = customer(1);
  const A = uuid(1);
  const B = uuid(2);

  beforeEach(async () => {
    h = buildOrderingHarness();
    await h.products.save(makeProduct({ id: A, name: 'A', stock: 5 }));
    await h.products.save(makeProduct({ id: B, name: 'B', stock: 1 }));
    await h.cart.addItem(ana.userId, A, 2);
    await h.cart.addItem(ana.userId, B, 1);
  });

  const request = (stock: { productId: string; quantity: number }[]) => ({
    order: makeOrder({ customerId: ana.userId }),
    stock,
    cartLines: [
      { itemId: A, quantity: 2 },
      { itemId: B, quantity: 1 },
    ],
  });

  it('daca al doilea produs nu are stoc, primul ramane neatins, fara comanda si cu cosul intact', async () => {
    await expect(
      h.placement.place(
        request([
          { productId: A, quantity: 2 },
          { productId: B, quantity: 2 }, // doar 1 in stoc
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    expect(await h.stockOf(A)).toBe(5);
    expect(await h.stockOf(B)).toBe(1);
    expect(await h.orders.findById(request([]).order.id)).toBeNull();
    expect((await h.cart.getCart(ana.userId)).itemCount).toBe(3);
  });

  it('un produs inexistent in stoc este tratat ca stoc insuficient', async () => {
    await expect(
      h.placement.place(request([{ productId: uuid(404), quantity: 1 }])),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('cosul modificat intre timp (alta cantitate) opreste plasarea: CART_CHANGED', async () => {
    await h.cart.updateQuantity(ana.userId, A, 3);
    await expect(h.placement.place(request([{ productId: A, quantity: 2 }]))).rejects.toMatchObject(
      { code: 'CART_CHANGED' },
    );
    expect(await h.stockOf(A)).toBe(5);
  });

  it('o plasare esuata nu blocheaza coada: urmatoarea reuseste', async () => {
    await expect(h.placement.place(request([{ productId: B, quantity: 9 }]))).rejects.toThrow();
    await h.placement.place(request([{ productId: A, quantity: 2 }]));
    expect(await h.stockOf(A)).toBe(3);
  });

  it('succesul scade stocul, salveaza comanda si goleste doar liniile comandate', async () => {
    await h.products.save(makeProduct({ id: uuid(3), name: 'C', stock: 9 }));
    await h.cart.addItem(ana.userId, uuid(3), 4); // linie care NU face parte din cererea de plasare

    const req = request([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 1 },
    ]);
    await h.placement.place(req);

    expect(await h.stockOf(A)).toBe(3);
    expect(await h.stockOf(B)).toBe(0);
    expect((await h.orders.findById(req.order.id))?.id).toBe(req.order.id);
    const remaining = await h.cart.getCart(ana.userId);
    expect(remaining.lines.map((l) => [l.itemId, l.quantity])).toEqual([[uuid(3), 4]]);
  });
});

describe('CatalogOrderLookup (anti-corruption layer)', () => {
  const p1 = makeProduct({ id: uuid(1), name: 'P1', amount: 1_000, stock: 10 });
  const p2 = makeProduct({ id: uuid(2), name: 'P2', amount: 500, stock: 10 });
  const inner = Bundle.create({
    id: uuid(10),
    name: 'Interior',
    description: '',
    discountPercent: 0,
    components: [
      { item: p1, quantity: 2 },
      { item: p2, quantity: 1 },
    ],
  });
  // Pachet imbricat: 3 x Interior + 1 x P1 (exista in domeniu, chiar daca nu se poate salva inca).
  const outer = Bundle.create({
    id: uuid(11),
    name: 'Exterior',
    description: '',
    discountPercent: 10,
    components: [
      { item: inner, quantity: 3 },
      { item: p1, quantity: 1 },
    ],
  });

  const lookup = (items: CatalogItem[]) =>
    new CatalogOrderLookup({
      findItem: (id: string) => Promise.resolve(items.find((i) => i.id === id) ?? null),
    } as unknown as CatalogQueries);

  it('un produs simplu consuma propriul stoc', async () => {
    expect(await lookup([p1]).find(p1.id)).toMatchObject({
      id: p1.id,
      name: 'P1',
      availableStock: 10,
      stockPerUnit: [{ productId: p1.id, quantity: 1 }],
    });
    expect((await lookup([p1]).find(p1.id))?.unitPrice.amount).toBe(1_000);
  });

  it('un pachet consuma componentele lui, recursiv, cu cantitatile inmultite', async () => {
    const found = await lookup([outer]).find(outer.id);
    expect(found?.stockPerUnit).toEqual([
      { productId: uuid(1), quantity: 6 },
      { productId: uuid(2), quantity: 3 },
      { productId: uuid(1), quantity: 1 },
    ]);
    // pretul si stocul vin din Composite
    expect(found?.unitPrice.equals(outer.getPrice())).toBe(true);
    expect(found?.availableStock).toBe(outer.availableStock());
  });

  it('un articol inexistent -> null', async () => {
    expect(await lookup([]).find(uuid(99))).toBeNull();
  });
});
