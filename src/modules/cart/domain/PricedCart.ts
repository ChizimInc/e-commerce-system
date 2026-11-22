import { Money, type Currency } from '../../../shared';

/** Moneda unui cos gol (nu exista inca niciun pret din care sa o deducem). */
export const DEFAULT_CART_CURRENCY: Currency = 'RON';

/** Un articol din cos, deja rezolvat cu datele curente din catalog. */
export interface PricedLine {
  readonly itemId: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  /** Stocul disponibil acum in catalog. */
  readonly availableStock: number;
}

/**
 * Vederea unui cos cu preturi: linii + total, calculate cu `Money` (cenți intregi, fara float).
 * Toate liniile trebuie sa aiba aceeasi moneda; altfel `Money` refuza adunarea.
 */
export class PricedCart {
  readonly lines: readonly (PricedLine & { lineTotal: Money; inStock: boolean })[];
  readonly total: Money;
  /** Numarul total de bucati (suma cantitatilor). */
  readonly itemCount: number;

  private constructor(lines: readonly PricedLine[]) {
    this.lines = lines.map((line) => ({
      ...line,
      lineTotal: line.unitPrice.multiply(line.quantity),
      inStock: line.quantity <= line.availableStock,
    }));
    this.total = this.lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      Money.zero(this.lines[0]?.unitPrice.currency ?? DEFAULT_CART_CURRENCY),
    );
    this.itemCount = this.lines.reduce((count, line) => count + line.quantity, 0);
  }

  static of(lines: readonly PricedLine[]): PricedCart {
    return new PricedCart(lines);
  }
}
