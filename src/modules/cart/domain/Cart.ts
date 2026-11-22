import { DomainError, NotFoundError } from '../../../shared';

export const MAX_LINE_QUANTITY = 100;
export const MAX_CART_LINES = 50;

export interface CartItem {
  /** Id-ul produsului sau al pachetului din catalog. */
  readonly itemId: string;
  readonly quantity: number;
}

export interface CartProps {
  readonly id: string;
  readonly userId: string;
  readonly items: readonly CartItem[];
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw new DomainError(
      `Cantitatea trebuie sa fie un numar intreg intre 1 si ${MAX_LINE_QUANTITY}`,
      'INVALID_QUANTITY',
    );
  }
}

/**
 * Cosul unui utilizator (agregat). Imutabil: fiecare operatie intoarce un cos nou, deci o operatie
 * respinsa (cantitate invalida, articol lipsa) nu poate lasa cosul intr-o stare partiala.
 * Pastreaza doar referinte + cantitati; preturile si stocul se citesc din catalog la fiecare vizualizare.
 */
export class Cart {
  readonly id: string;
  readonly userId: string;
  readonly items: readonly CartItem[];

  private constructor(props: CartProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.items = props.items;
  }

  static empty(id: string, userId: string): Cart {
    return new Cart({ id, userId, items: [] });
  }

  /** Reconstruieste un cos salvat (repository-urile); valideaza aceleasi invarianti. */
  static restore(props: CartProps): Cart {
    const seen = new Set<string>();
    for (const item of props.items) {
      assertQuantity(item.quantity);
      if (seen.has(item.itemId)) {
        throw new DomainError(`Articol duplicat in cos: ${item.itemId}`, 'INVALID_CART');
      }
      seen.add(item.itemId);
    }
    return new Cart({ ...props, items: [...props.items] });
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  quantityOf(itemId: string): number {
    return this.items.find((item) => item.itemId === itemId)?.quantity ?? 0;
  }

  /** Adauga articolul sau, daca exista deja, aduna cantitatea. */
  addItem(itemId: string, quantity: number): Cart {
    assertQuantity(quantity);
    const existing = this.quantityOf(itemId);
    if (existing === 0) {
      if (this.items.length >= MAX_CART_LINES) {
        throw new DomainError(
          `Cosul poate avea cel mult ${MAX_CART_LINES} de articole diferite`,
          'CART_FULL',
        );
      }
      return new Cart({ ...this, items: [...this.items, { itemId, quantity }] });
    }
    const total = existing + quantity;
    if (total > MAX_LINE_QUANTITY) {
      throw new DomainError(
        `Cantitatea per articol nu poate depasi ${MAX_LINE_QUANTITY}`,
        'INVALID_QUANTITY',
      );
    }
    return this.withItems(
      this.items.map((i) => (i.itemId === itemId ? { itemId, quantity: total } : i)),
    );
  }

  setQuantity(itemId: string, quantity: number): Cart {
    assertQuantity(quantity);
    this.assertContains(itemId);
    return this.withItems(this.items.map((i) => (i.itemId === itemId ? { itemId, quantity } : i)));
  }

  removeItem(itemId: string): Cart {
    this.assertContains(itemId);
    return this.withItems(this.items.filter((i) => i.itemId !== itemId));
  }

  /** Pastreaza doar articolele din `itemIds` (ex. cele care mai exista in catalog). */
  retainOnly(itemIds: ReadonlySet<string>): Cart {
    const kept = this.items.filter((item) => itemIds.has(item.itemId));
    return kept.length === this.items.length ? this : this.withItems(kept);
  }

  clear(): Cart {
    return this.withItems([]);
  }

  private assertContains(itemId: string): void {
    if (this.quantityOf(itemId) === 0) throw new NotFoundError('Articol din cos', itemId);
  }

  private withItems(items: readonly CartItem[]): Cart {
    return new Cart({ id: this.id, userId: this.userId, items });
  }
}
