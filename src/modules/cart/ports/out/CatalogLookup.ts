import type { Money } from '../../../../shared';

/** Ce trebuie sa stie cosul despre un produs sau un pachet din catalog. */
export interface PurchasableItem {
  readonly id: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly availableStock: number;
}

/**
 * Port de iesire: cosul isi citeste datele din catalog fara sa depinda de modelul lui intern.
 * Adaptorul (anti-corruption layer) traduce din modulul `catalog`.
 */
export interface CatalogLookup {
  /** Produs sau pachet dupa id; `null` daca nu mai exista. */
  find(itemId: string): Promise<PurchasableItem | null>;
}
