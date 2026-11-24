import type { StockDeduction } from './OrderPlacement';

/**
 * Port de iesire: repunerea in stoc a produselor unei comenzi anulate.
 *
 * Idempotent pe comanda: pentru acelasi `orderId`, doar prima apelare repune stocul; urmatoarele
 * (aceeasi anulare procesata de doua ori) nu fac nimic. Marcarea comenzii si cresterea stocului se
 * fac impreuna (atomic), ca doua procesari concurente sa nu repuna stocul de doua ori.
 */
export interface StockRestoration {
  /**
   * @param stock produsele simple si cantitatile de repus (pachetele sunt deja descompuse in componente)
   * @returns `true` daca stocul a fost repus acum, `false` daca comanda fusese deja procesata
   */
  restore(orderId: string, stock: readonly StockDeduction[]): Promise<boolean>;
}
