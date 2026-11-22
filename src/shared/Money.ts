import { DomainError } from './DomainError';

/** Monedele acceptate. Toate au 2 zecimale (unitatea minora = 1/100). */
export const SUPPORTED_CURRENCIES = ['RON', 'EUR', 'USD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const MINOR_UNITS_PER_MAJOR = 100;

/** Rotunjire „half away from zero" (2.5 -> 3, -2.5 -> -3), uzuala in calcule comerciale. */
function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Value object imutabil pentru bani: suma in unitati minore (cenți) ca numar intreg + moneda.
 * Nu se folosesc niciodata float-uri pentru sume (vezi docs/PLAN.md §6).
 */
export class Money {
  private constructor(
    /** Suma in cenți (numar intreg, poate fi negativ pentru diferente/rambursari). */
    readonly amount: number,
    readonly currency: Currency,
  ) {}

  static of(amount: number, currency: Currency): Money {
    if (!Number.isSafeInteger(amount)) {
      throw new DomainError(
        `Suma trebuie sa fie un numar intreg de cenți, primit: ${amount}`,
        'MONEY_INVALID_AMOUNT',
      );
    }
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      throw new DomainError(`Moneda nesuportata: ${currency}`, 'MONEY_UNSUPPORTED_CURRENCY');
    }
    // Normalizeaza -0 la 0, ca sa nu apara diferente la Object.is / serializare.
    return new Money(amount === 0 ? 0 : amount, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount - other.amount, this.currency);
  }

  /** Inmultire cu o cantitate intreaga (ex. pret x bucati). */
  multiply(quantity: number): Money {
    if (!Number.isSafeInteger(quantity)) {
      throw new DomainError(
        `Factorul de inmultire trebuie sa fie intreg, primit: ${quantity}`,
        'MONEY_INVALID_FACTOR',
      );
    }
    return Money.of(this.amount * quantity, this.currency);
  }

  /** Procent din suma (ex. TVA 19%, reducere 10%), rotunjit la cent. */
  percentage(percent: number): Money {
    if (!Number.isFinite(percent)) {
      throw new DomainError(`Procent invalid: ${percent}`, 'MONEY_INVALID_PERCENT');
    }
    return Money.of(roundHalfAwayFromZero((this.amount * percent) / 100), this.currency);
  }

  negate(): Money {
    return Money.of(-this.amount, this.currency);
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  isNegative(): boolean {
    return this.amount < 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount < other.amount;
  }

  /** Format lizibil, ex. `1234.50 RON`. */
  toString(): string {
    const sign = this.amount < 0 ? '-' : '';
    const abs = Math.abs(this.amount);
    const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
    const minor = String(abs % MINOR_UNITS_PER_MAJOR).padStart(2, '0');
    return `${sign}${major}.${minor} ${this.currency}`;
  }

  toJSON(): { amount: number; currency: Currency } {
    return { amount: this.amount, currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        `Monede diferite: ${this.currency} si ${other.currency}`,
        'MONEY_CURRENCY_MISMATCH',
      );
    }
  }
}
