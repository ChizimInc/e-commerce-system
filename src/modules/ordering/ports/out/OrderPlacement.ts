import type { Order } from '../../domain/Order';

/** Cate bucati dintr-un produs (simplu) trebuie scazute din stoc. Pachetele sunt deja descompuse in produse. */
export interface StockDeduction {
  readonly productId: string;
  readonly quantity: number;
}

/** O linie din cosul care a stat la baza comenzii. */
export interface ConsumedCartLine {
  readonly itemId: string;
  readonly quantity: number;
}

export interface OrderPlacementRequest {
  readonly order: Order;
  readonly stock: readonly StockDeduction[];
  /** Liniile cosului citit la crearea comenzii; se sterg din cos, cu conditia sa fie inca identice. */
  readonly cartLines: readonly ConsumedCartLine[];
}

/**
 * Port de iesire: plasarea atomica a unei comenzi. Intr-o singura tranzactie:
 *  1. scade stocul fiecarui produs, fara sa-l lase sub zero (altfel `ConflictError(INSUFFICIENT_STOCK)`);
 *  2. salveaza comanda;
 *  3. sterge din cos liniile comandate (daca cosul s-a modificat intre timp: `ConflictError(CART_CHANGED)`,
 *     ceea ce opreste si dubla trimitere a aceluiasi cos).
 * Daca oricare pas esueaza, nu ramane nicio modificare.
 */
export interface OrderPlacement {
  place(request: OrderPlacementRequest): Promise<void>;
}
