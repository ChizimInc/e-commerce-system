import { Money, type Currency } from '../../src/shared';
import { Category } from '../../src/modules/catalog/domain/Category';
import { Product } from '../../src/modules/catalog/domain/Product';
import { uuid } from './ids';

export function makeProduct(
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
    amount: number;
    currency: Currency;
    stock: number;
    categoryId: string | null;
  }> = {},
): Product {
  return Product.create({
    id: overrides.id ?? uuid(1),
    name: overrides.name ?? 'Tastatura',
    description: overrides.description ?? '',
    price: Money.of(overrides.amount ?? 10_000, overrides.currency ?? 'RON'),
    stock: overrides.stock ?? 10,
    categoryId: overrides.categoryId ?? null,
  });
}

export function makeCategory(id: string, name: string, parentId: string | null = null): Category {
  return Category.create({ id, name, parentId });
}
