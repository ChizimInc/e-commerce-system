import { DomainError, type Money } from '../../../shared';
import type { CatalogItem, StockRequirement } from './CatalogItem';
import { optionalText, requireIntegerInRange, requireText } from './validation';

export const MAX_PRICE_CENTS = 1_000_000_000;
export const MAX_STOCK = 1_000_000;

export interface ProductProps {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly price: Money;
  readonly stock: number;
  readonly categoryId: string | null;
}

/** Campurile modificabile ale unui produs; `undefined` = ramane neschimbat. */
export type ProductChanges = {
  readonly [K in keyof Omit<ProductProps, 'id'>]?: ProductProps[K] | undefined;
};

// Pattern: Composite (Structural) – frunza: Product implementeaza CatalogItem, la fel ca Bundle (compusul)
export class Product implements CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly price: Money;
  readonly stock: number;
  readonly categoryId: string | null;

  private constructor(props: ProductProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.price = props.price;
    this.stock = props.stock;
    this.categoryId = props.categoryId;
  }

  /** Singura cale de a construi un produs: valideaza invariantii (nume, pret >= 0, stoc >= 0). */
  static create(props: ProductProps): Product {
    if (props.price.isNegative()) {
      throw new DomainError('Pretul nu poate fi negativ', 'VALIDATION_ERROR');
    }
    if (props.price.amount > MAX_PRICE_CENTS) {
      throw new DomainError('Pretul depaseste maximul permis', 'VALIDATION_ERROR');
    }
    return new Product({
      id: props.id,
      name: requireText(props.name, 'Numele produsului', 200),
      description: optionalText(props.description, 'Descrierea produsului', 2000),
      price: props.price,
      stock: requireIntegerInRange(props.stock, 'Stocul', 0, MAX_STOCK),
      categoryId: props.categoryId,
    });
  }

  getPrice(): Money {
    return this.price;
  }

  availableStock(): number {
    return this.stock;
  }

  stockRequirements(): StockRequirement[] {
    return [{ productId: this.id, quantity: 1 }];
  }

  /** Produsele sunt imutabile: o modificare intoarce o copie validata. */
  withChanges(changes: ProductChanges): Product {
    return Product.create({
      id: this.id,
      name: changes.name ?? this.name,
      description: changes.description ?? this.description,
      price: changes.price ?? this.price,
      stock: changes.stock ?? this.stock,
      categoryId: changes.categoryId === undefined ? this.categoryId : changes.categoryId,
    });
  }
}
