import { describe, expect, it } from 'vitest';
import { DomainError, Money } from '../../../src/shared';
import { Product } from '../../../src/modules/catalog/domain/Product';
import { makeProduct } from '../../helpers/catalog-fixtures';

describe('Product', () => {
  it('stockRequirements: un produs consuma propriul stoc, cate o bucata', () => {
    expect(makeProduct({ id: 'p-1' }).stockRequirements()).toEqual([
      { productId: 'p-1', quantity: 1 },
    ]);
  });

  it('expune pretul si stocul prin interfata CatalogItem', () => {
    const product = makeProduct({ amount: 2599, stock: 7 });
    expect(product.getPrice().equals(Money.of(2599, 'RON'))).toBe(true);
    expect(product.availableStock()).toBe(7);
  });

  it('elimina spatiile din nume si descriere', () => {
    const product = makeProduct({ name: '  Mouse  ', description: ' optic ' });
    expect(product.name).toBe('Mouse');
    expect(product.description).toBe('optic');
  });

  it.each([
    ['nume gol', { name: '   ' }],
    ['nume prea lung', { name: 'x'.repeat(201) }],
    ['pret negativ', { amount: -1 }],
    ['pret peste maxim', { amount: 1_000_000_001 }],
    ['stoc negativ', { stock: -1 }],
    ['stoc fractionar', { stock: 1.5 }],
  ])('refuza %s', (_label, overrides) => {
    expect(() => makeProduct(overrides)).toThrowError(DomainError);
  });

  it('withChanges intoarce o copie noua si nu modifica originalul', () => {
    const original = makeProduct({ name: 'A', stock: 5 });
    const changed = original.withChanges({ stock: 2 });
    expect(changed).not.toBe(original);
    expect(changed.stock).toBe(2);
    expect(original.stock).toBe(5);
    expect(changed.name).toBe('A');
  });

  it('withChanges poate seta categoria la null explicit si o pastreaza cand lipseste', () => {
    const inCategory = makeProduct({ categoryId: '00000000-0000-4000-8000-0000000000aa' });
    expect(inCategory.withChanges({}).categoryId).toBe(inCategory.categoryId);
    expect(inCategory.withChanges({ categoryId: undefined }).categoryId).toBe(
      inCategory.categoryId,
    );
    expect(inCategory.withChanges({ categoryId: null }).categoryId).toBeNull();
  });

  it('valideaza si la withChanges', () => {
    expect(() => makeProduct().withChanges({ stock: -5 })).toThrowError(DomainError);
    expect(() => makeProduct().withChanges({ price: Money.of(-5, 'RON') })).toThrowError(
      DomainError,
    );
  });

  it('create nu accepta pret negativ', () => {
    expect(() =>
      Product.create({
        id: 'x',
        name: 'N',
        description: '',
        price: Money.of(-5, 'RON'),
        stock: 1,
        categoryId: null,
      }),
    ).toThrowError(/negativ/);
  });
});
