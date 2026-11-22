import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, DomainError, Money, NotFoundError } from '../../../src/shared';
import { CatalogItemLookup } from '../../../src/modules/cart/adapters/catalog/CatalogItemLookup';
import { InMemoryCartRepository } from '../../../src/modules/cart/adapters/persistence/InMemoryCartRepository';
import { CartService } from '../../../src/modules/cart/application/CartService';
import { CatalogAdminUseCases } from '../../../src/modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from '../../../src/modules/catalog/application/CatalogQueryService';
import { createInMemoryRepositories } from '../../../src/composition-root';
import { SequentialIdGenerator, uuid } from '../../helpers/ids';
import { silentLogger } from '../../helpers/silent-logger';

const USER = uuid(900);
const OTHER_USER = uuid(901);

function setup() {
  const repositories = createInMemoryRepositories();
  const catalogAdmin = new CatalogAdminUseCases(
    repositories.products,
    repositories.categories,
    repositories.bundles,
    new SequentialIdGenerator(5000),
    silentLogger,
  );
  const queries = new CatalogQueryService(
    repositories.products,
    repositories.categories,
    repositories.bundles,
  );
  const carts = new InMemoryCartRepository();
  const cart = new CartService(
    carts,
    new CatalogItemLookup(queries),
    new SequentialIdGenerator(8000),
  );
  return { cart, carts, catalogAdmin };
}

const price = (amount: number, currency: 'RON' | 'EUR' = 'RON') => ({ amount, currency });

describe('CartService', () => {
  let ctx: ReturnType<typeof setup>;
  let mouseId: string;
  let keyboardId: string;

  beforeEach(async () => {
    ctx = setup();
    mouseId = (
      await ctx.catalogAdmin.createProduct({ name: 'Mouse', price: price(5000), stock: 5 })
    ).id;
    keyboardId = (
      await ctx.catalogAdmin.createProduct({ name: 'Tastatura', price: price(12_999), stock: 2 })
    ).id;
  });

  it('un utilizator fara cos primeste un cos gol (fara sa se salveze nimic)', async () => {
    const cart = await ctx.cart.getCart(USER);
    expect(cart.lines).toEqual([]);
    expect(cart.total.isZero()).toBe(true);
    expect(await ctx.carts.findByUserId(USER)).toBeNull();
  });

  it('adauga articole si calculeaza totalul cu Money', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    const cart = await ctx.cart.addItem(USER, keyboardId, 1);
    expect(cart.lines.map((l) => [l.name, l.quantity, l.lineTotal.amount])).toEqual([
      ['Mouse', 2, 10_000],
      ['Tastatura', 1, 12_999],
    ]);
    expect(cart.total.equals(Money.of(22_999, 'RON'))).toBe(true);
    expect(cart.itemCount).toBe(3);
  });

  it('adaugarea aceluiasi articol aduna cantitatea', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    const cart = await ctx.cart.addItem(USER, mouseId, 1);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(3);
  });

  it('persista cosul: o citire ulterioara il regaseste', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    expect((await ctx.cart.getCart(USER)).itemCount).toBe(2);
  });

  it('cosurile utilizatorilor sunt separate', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    expect((await ctx.cart.getCart(OTHER_USER)).lines).toEqual([]);
  });

  it('valideaza stocul la adaugare: cantitatea totala nu poate depasi stocul', async () => {
    await ctx.cart.addItem(USER, keyboardId, 2); // stoc 2
    await expect(ctx.cart.addItem(USER, keyboardId, 1)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect((await ctx.cart.getCart(USER)).lines[0]?.quantity).toBe(2); // neschimbat
  });

  it('refuza un articol fara stoc, fara sa creeze un cos', async () => {
    const soldOut = await ctx.catalogAdmin.createProduct({
      name: 'Epuizat',
      price: price(100),
      stock: 0,
    });
    await expect(ctx.cart.addItem(USER, soldOut.id, 1)).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.carts.findByUserId(USER)).toBeNull();
  });

  it('refuza un articol inexistent in catalog', async () => {
    await expect(ctx.cart.addItem(USER, uuid(777), 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuza cantitati invalide', async () => {
    await expect(ctx.cart.addItem(USER, mouseId, 0)).rejects.toBeInstanceOf(DomainError);
    await expect(ctx.cart.addItem(USER, mouseId, 1.5)).rejects.toBeInstanceOf(DomainError);
  });

  it('modifica cantitatea si valideaza stocul', async () => {
    await ctx.cart.addItem(USER, mouseId, 1);
    const updated = await ctx.cart.updateQuantity(USER, mouseId, 4);
    expect(updated.lines[0]?.quantity).toBe(4);
    expect(updated.total.amount).toBe(20_000);
    await expect(ctx.cart.updateQuantity(USER, mouseId, 6)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect((await ctx.cart.getCart(USER)).lines[0]?.quantity).toBe(4);
  });

  it('nu poate modifica un articol care nu e in cos', async () => {
    await expect(ctx.cart.updateQuantity(USER, mouseId, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sterge un articol si recalculeaza totalul; NotFound daca nu e in cos', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    await ctx.cart.addItem(USER, keyboardId, 1);
    const cart = await ctx.cart.removeItem(USER, mouseId);
    expect(cart.lines.map((l) => l.name)).toEqual(['Tastatura']);
    expect(cart.total.amount).toBe(12_999);
    await expect(ctx.cart.removeItem(USER, mouseId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('goleste cosul', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    const cart = await ctx.cart.clear(USER);
    expect(cart.lines).toEqual([]);
    expect(cart.total.isZero()).toBe(true);
  });

  it('refuza monede diferite in acelasi cos, fara sa strice cosul existent', async () => {
    const eur = await ctx.catalogAdmin.createProduct({
      name: 'In euro',
      price: price(100, 'EUR'),
      stock: 5,
    });
    await ctx.cart.addItem(USER, mouseId, 1);
    await expect(ctx.cart.addItem(USER, eur.id, 1)).rejects.toMatchObject({
      code: 'MONEY_CURRENCY_MISMATCH',
    });
    const cart = await ctx.cart.getCart(USER);
    expect(cart.lines).toHaveLength(1);
    expect(cart.total.currency).toBe('RON');
  });

  it('foloseste preturile curente din catalog (nu un pret copiat la adaugare)', async () => {
    await ctx.cart.addItem(USER, mouseId, 2);
    await ctx.catalogAdmin.updateProduct(mouseId, { price: price(6000) });
    expect((await ctx.cart.getCart(USER)).total.amount).toBe(12_000);
  });

  it('semnaleaza stocul scazut dupa adaugare (inStock = false), fara sa piarda articolul', async () => {
    await ctx.cart.addItem(USER, mouseId, 4);
    await ctx.catalogAdmin.updateProduct(mouseId, { stock: 1 });
    const line = (await ctx.cart.getCart(USER)).lines[0];
    expect(line).toMatchObject({ quantity: 4, availableStock: 1, inStock: false });
  });

  it('un articol disparut din catalog nu apare in cos, dar poate fi scos oricand', async () => {
    await ctx.cart.addItem(USER, mouseId, 1);
    await ctx.cart.addItem(USER, keyboardId, 1);
    await ctx.catalogAdmin.deleteProduct(keyboardId);

    const cart = await ctx.cart.getCart(USER);
    expect(cart.lines.map((l) => l.name)).toEqual(['Mouse']);
    expect(cart.total.amount).toBe(5000);
    await expect(ctx.cart.removeItem(USER, keyboardId)).resolves.toBeDefined();
    await expect(ctx.cart.updateQuantity(USER, mouseId, 2)).resolves.toBeDefined();
  });

  it('elimina din cos articolele disparute din catalog la urmatoarea modificare (nu raman invizibile)', async () => {
    await ctx.cart.addItem(USER, mouseId, 1);
    await ctx.cart.addItem(USER, keyboardId, 1);
    await ctx.catalogAdmin.deleteProduct(keyboardId);
    expect((await ctx.carts.findByUserId(USER))?.items).toHaveLength(2); // inca stocat

    await ctx.cart.updateQuantity(USER, mouseId, 2);

    expect((await ctx.carts.findByUserId(USER))?.items).toEqual([{ itemId: mouseId, quantity: 2 }]);
  });

  it('accepta si pachete (tratate uniform cu produsele): pret calculat, stoc dat de componente', async () => {
    const bundle = await ctx.catalogAdmin.createBundle({
      name: 'Set',
      discountPercent: 10,
      items: [
        { productId: mouseId, quantity: 1 },
        { productId: keyboardId, quantity: 1 },
      ],
    });
    // (5000 + 12999) - 10% = 16199 (rotunjit); stoc: min(5, 2) = 2
    const cart = await ctx.cart.addItem(USER, bundle.id, 2);
    expect(cart.lines[0]).toMatchObject({ name: 'Set', availableStock: 2, quantity: 2 });
    expect(cart.total.amount).toBe(2 * (17_999 - Math.round(17_999 * 0.1)));
    await expect(ctx.cart.addItem(USER, bundle.id, 1)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });
});
