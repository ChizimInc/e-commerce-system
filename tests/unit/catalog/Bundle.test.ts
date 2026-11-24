import { describe, expect, it } from 'vitest';
import { DomainError, Money } from '../../../src/shared';
import { Bundle } from '../../../src/modules/catalog/domain/Bundle';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';

const mouse = makeProduct({ id: uuid(1), name: 'Mouse', amount: 5000, stock: 10 });
const keyboard = makeProduct({ id: uuid(2), name: 'Tastatura', amount: 10_000, stock: 9 });
const pad = makeProduct({ id: uuid(3), name: 'Covoras', amount: 2000, stock: 100 });

function bundle(overrides: Partial<Parameters<typeof Bundle.create>[0]> = {}): Bundle {
  return Bundle.create({
    id: uuid(100),
    name: 'Set birou',
    description: '',
    discountPercent: 0,
    components: [
      { item: mouse, quantity: 1 },
      { item: keyboard, quantity: 2 },
    ],
    ...overrides,
  });
}

// Composite (S5): Product (frunza) si Bundle (compus) se folosesc prin aceeasi interfata CatalogItem.
describe('Bundle.stockRequirements (Composite)', () => {
  it('un pachet consuma componentele lui, recursiv, cu cantitatile inmultite', () => {
    const inner = bundle({ id: uuid(101) }); // 1 x mouse + 2 x tastatura
    const outer = bundle({
      id: uuid(102),
      components: [
        { item: inner, quantity: 3 },
        { item: pad, quantity: 1 },
      ],
    });
    expect(outer.stockRequirements()).toEqual([
      { productId: uuid(1), quantity: 3 },
      { productId: uuid(2), quantity: 6 },
      { productId: uuid(3), quantity: 1 },
    ]);
  });
});

describe('Bundle (Composite)', () => {
  it('calculeaza pretul din componente: suma (pret x cantitate)', () => {
    expect(
      bundle()
        .getPrice()
        .equals(Money.of(5000 + 2 * 10_000, 'RON')),
    ).toBe(true);
  });

  it('aplica reducerea pachetului asupra sumei componentelor', () => {
    // 25.000 - 10% = 22.500
    expect(bundle({ discountPercent: 10 }).getPrice().amount).toBe(22_500);
  });

  it('se trateaza uniform cu produsul: aceeasi interfata pentru pret si stoc', () => {
    const items = [mouse, bundle()];
    const total = items.reduce((sum, item) => sum.add(item.getPrice()), Money.zero('RON'));
    expect(total.amount).toBe(5000 + 25_000);
    expect(items.map((item) => item.availableStock())).toEqual([10, 4]);
  });

  it('suporta pachete imbricate: un Bundle poate contine alt Bundle', () => {
    const inner = bundle();
    const outer = Bundle.create({
      id: uuid(200),
      name: 'Set complet',
      description: '',
      discountPercent: 20,
      components: [
        { item: inner, quantity: 1 },
        { item: pad, quantity: 3 },
      ],
    });
    // (25.000 + 3 x 2.000) = 31.000, minus 20% = 24.800
    expect(outer.getPrice().amount).toBe(24_800);
    // limitat de pachetul interior: floor(9 / 2) = 4
    expect(outer.availableStock()).toBe(4);
  });

  it('stocul pachetului este dat de componenta cea mai slaba (floor(stoc / cantitate))', () => {
    expect(bundle().availableStock()).toBe(4); // tastatura: 9 / 2
    const soldOut = bundle({
      components: [
        { item: mouse, quantity: 1 },
        { item: makeProduct({ id: uuid(9), stock: 0 }), quantity: 1 },
      ],
    });
    expect(soldOut.availableStock()).toBe(0);
  });

  it('refuza un pachet fara componente', () => {
    expect(() => bundle({ components: [] })).toThrowError(DomainError);
  });

  it('refuza componente duplicate si auto-includerea', () => {
    expect(() =>
      bundle({
        components: [
          { item: mouse, quantity: 1 },
          { item: mouse, quantity: 2 },
        ],
      }),
    ).toThrowError(/de mai multe ori/);
    expect(() =>
      bundle({ components: [{ item: makeProduct({ id: uuid(100) }), quantity: 1 }] }),
    ).toThrowError(/pe sine/);
  });

  it.each([0, -1, 1.5, 101])('refuza cantitatea de componenta %s', (quantity) => {
    expect(() => bundle({ components: [{ item: mouse, quantity }] })).toThrowError(DomainError);
  });

  it.each([-1, 91, 10.5])('refuza reducerea %s', (discountPercent) => {
    expect(() => bundle({ discountPercent })).toThrowError(DomainError);
  });

  it('refuza componente in monede diferite', () => {
    const eur = makeProduct({ id: uuid(7), amount: 1000, currency: 'EUR' });
    expect(() =>
      bundle({
        components: [
          { item: mouse, quantity: 1 },
          { item: eur, quantity: 1 },
        ],
      }),
    ).toThrowError(/Monede diferite/);
  });

  it('productComponents intoarce produsele si refuza pachetele imbricate (nesalvabile)', () => {
    expect(
      bundle()
        .productComponents()
        .map((c) => c.product.id),
    ).toEqual([uuid(1), uuid(2)]);
    const nested = Bundle.create({
      id: uuid(300),
      name: 'Imbricat',
      description: '',
      discountPercent: 0,
      components: [{ item: bundle(), quantity: 1 }],
    });
    expect(() => nested.productComponents()).toThrowError(/imbricate/);
  });

  it('withChanges recalculeaza pretul cu noile componente', () => {
    const changed = bundle().withChanges({ components: [{ item: pad, quantity: 5 }] });
    expect(changed.getPrice().amount).toBe(10_000);
  });
});
