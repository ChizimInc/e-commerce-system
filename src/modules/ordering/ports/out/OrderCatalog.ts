import type { Money } from '../../../../shared';
import type { StockDeduction } from './OrderPlacement';

/** Ce trebuie sa stie comanda despre un produs sau un pachet din catalog. */
export interface OrderableItem {
  readonly id: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly availableStock: number;
  /** Produsele simple al caror stoc se consuma cand se comanda o bucata (pentru un pachet: componentele lui). */
  readonly stockPerUnit: readonly StockDeduction[];
}

/** Port de iesire (anti-corruption layer spre `catalog`): comanda nu depinde de modelul intern al catalogului. */
export interface OrderCatalog {
  /** Produs sau pachet dupa id; `null` daca nu mai exista. */
  find(itemId: string): Promise<OrderableItem | null>;
}
