import { describe, expect, it } from 'vitest';
import { DomainError, Money, NotFoundError } from '../../../src/shared';
import { Cart, MAX_CART_LINES, MAX_LINE_QUANTITY } from '../../../src/modules/cart/domain/Cart';
import { PricedCart } from '../../../src/modules/cart/domain/PricedCart';
import { uuid } from '../../helpers/ids';

const empty = () => Cart.empty(uuid(1), uuid(2));

describe('Cart', () => {
  it('porneste gol', () => {
    expect(empty().isEmpty).toBe(true);
    expect(empty().quantityOf(uuid(10))).toBe(0);
  });

  it('adauga un articol si aduna cantitatea cand exista deja', () => {
    const cart = empty().addItem(uuid(10), 2).addItem(uuid(11), 1).addItem(uuid(10), 3);
    expect(cart.items).toEqual([
      { itemId: uuid(10), quantity: 5 },
      { itemId: uuid(11), quantity: 1 },
    ]);
  });

  it('este imutabil: operatiile intorc un cos nou', () => {
    const original = empty();
    const changed = original.addItem(uuid(10), 1);
    expect(original.isEmpty).toBe(true);
    expect(changed).not.toBe(original);
    expect(changed.id).toBe(original.id);
    expect(changed.userId).toBe(original.userId);
  });

  it.each([0, -1, 1.5, MAX_LINE_QUANTITY + 1, Number.NaN])('refuza cantitatea %s', (quantity) => {
    expect(() => empty().addItem(uuid(10), quantity)).toThrowError(DomainError);
    expect(() => empty().addItem(uuid(10), 1).setQuantity(uuid(10), quantity)).toThrowError(
      DomainError,
    );
  });

  it('refuza ca suma cantitatilor unui articol sa depaseasca maximul', () => {
    const cart = empty().addItem(uuid(10), MAX_LINE_QUANTITY);
    expect(() => cart.addItem(uuid(10), 1)).toThrowError(/nu poate depasi/);
  });

  it('refuza mai mult de MAX_CART_LINES articole diferite', () => {
    let cart = empty();
    for (let i = 0; i < MAX_CART_LINES; i++) cart = cart.addItem(uuid(100 + i), 1);
    expect(() => cart.addItem(uuid(999), 1)).toThrowError(/cel mult/);
    expect(cart.addItem(uuid(100), 1).quantityOf(uuid(100))).toBe(2); // unul existent merge
  });

  it('seteaza cantitatea unui articol existent; NotFound pentru unul lipsa', () => {
    const cart = empty().addItem(uuid(10), 5).setQuantity(uuid(10), 2);
    expect(cart.quantityOf(uuid(10))).toBe(2);
    expect(() => cart.setQuantity(uuid(11), 1)).toThrowError(NotFoundError);
  });

  it('sterge un articol; NotFound pentru unul lipsa', () => {
    const cart = empty().addItem(uuid(10), 1).addItem(uuid(11), 1).removeItem(uuid(10));
    expect(cart.items.map((i) => i.itemId)).toEqual([uuid(11)]);
    expect(() => cart.removeItem(uuid(10))).toThrowError(NotFoundError);
  });

  it('retainOnly pastreaza doar articolele date (si intoarce acelasi cos daca nu s-a schimbat nimic)', () => {
    const cart = empty().addItem(uuid(10), 1).addItem(uuid(11), 2);
    expect(cart.retainOnly(new Set([uuid(10), uuid(11), uuid(12)]))).toBe(cart);
    expect(cart.retainOnly(new Set([uuid(11)])).items).toEqual([{ itemId: uuid(11), quantity: 2 }]);
    expect(cart.retainOnly(new Set()).isEmpty).toBe(true);
  });

  it('clear goleste cosul pastrand identitatea', () => {
    const cleared = empty().addItem(uuid(10), 1).clear();
    expect(cleared.isEmpty).toBe(true);
    expect(cleared.id).toBe(uuid(1));
  });

  it('restore valideaza datele salvate (cantitati si duplicate)', () => {
    const base = { id: uuid(1), userId: uuid(2) };
    expect(() =>
      Cart.restore({ ...base, items: [{ itemId: uuid(10), quantity: 0 }] }),
    ).toThrowError(DomainError);
    expect(() =>
      Cart.restore({
        ...base,
        items: [
          { itemId: uuid(10), quantity: 1 },
          { itemId: uuid(10), quantity: 2 },
        ],
      }),
    ).toThrowError(/duplicat/);
    expect(
      Cart.restore({ ...base, items: [{ itemId: uuid(10), quantity: 3 }] }).quantityOf(uuid(10)),
    ).toBe(3);
  });
});

describe('PricedCart (total cu Money)', () => {
  const line = (
    itemId: string,
    amount: number,
    quantity: number,
    availableStock = 100,
    currency: 'RON' | 'EUR' = 'RON',
  ) => ({
    itemId,
    name: `Articol ${itemId.slice(-2)}`,
    unitPrice: Money.of(amount, currency),
    quantity,
    availableStock,
  });

  it('calculeaza totalul pe linie si pe cos in cenți intregi', () => {
    const priced = PricedCart.of([line(uuid(10), 1999, 3), line(uuid(11), 505, 2)]);
    expect(priced.lines.map((l) => l.lineTotal.amount)).toEqual([5997, 1010]);
    expect(priced.total.equals(Money.of(7007, 'RON'))).toBe(true);
    expect(priced.total.toString()).toBe('70.07 RON');
    expect(priced.itemCount).toBe(5);
  });

  it('evita erorile de float: 3 x 0.10 = 0.30 exact', () => {
    expect(PricedCart.of([line(uuid(10), 10, 3)]).total.amount).toBe(30);
  });

  it('un cos gol are total zero in moneda implicita', () => {
    const priced = PricedCart.of([]);
    expect(priced.total.isZero()).toBe(true);
    expect(priced.total.currency).toBe('RON');
    expect(priced.itemCount).toBe(0);
  });

  it('totalul preia moneda articolelor', () => {
    expect(PricedCart.of([line(uuid(10), 100, 1, 5, 'EUR')]).total.currency).toBe('EUR');
  });

  it('refuza monede diferite in acelasi cos', () => {
    expect(() =>
      PricedCart.of([line(uuid(10), 100, 1), line(uuid(11), 100, 1, 5, 'EUR')]),
    ).toThrowError(/Monede diferite/);
  });

  it('marcheaza liniile cu stoc insuficient (inStock = false)', () => {
    const priced = PricedCart.of([line(uuid(10), 100, 3, 2), line(uuid(11), 100, 2, 2)]);
    expect(priced.lines.map((l) => l.inStock)).toEqual([false, true]);
  });
});
