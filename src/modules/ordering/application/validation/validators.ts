import { ConflictError, DomainError, Money, TooManyRequestsError } from '../../../../shared';
import type { OrderRepository } from '../../ports/out/OrderRepository';
import { AbstractCheckoutValidator, type CheckoutContext } from './CheckoutValidator';

// Pattern: Chain of Responsibility (Behavioral) – veriga 1: stocul disponibil acopera fiecare linie (409 INSUFFICIENT_STOCK)
export class StockValidator extends AbstractCheckoutValidator {
  protected check({ lines }: CheckoutContext): void {
    for (const { item, quantity } of lines) {
      if (quantity > item.availableStock) {
        throw new ConflictError(
          `Stoc insuficient pentru "${item.name}": ai cerut ${quantity}, disponibil ${item.availableStock}`,
          'INSUFFICIENT_STOCK',
        );
      }
    }
  }
}

// Pattern: Chain of Responsibility (Behavioral) – veriga 2: livram doar in tarile configurate (422 UNSUPPORTED_COUNTRY)
export class AddressValidator extends AbstractCheckoutValidator {
  private readonly countries: ReadonlySet<string>;

  /** @param allowedCountries coduri ISO de 2 litere, ca in `Address` (lista goala = nu se livreaza nicaieri) */
  constructor(allowedCountries: readonly string[]) {
    super();
    this.countries = new Set(allowedCountries.map((country) => country.trim().toUpperCase()));
  }

  protected check({ order }: CheckoutContext): void {
    if (!this.countries.has(order.address.country)) {
      throw new DomainError(`Nu livram in tara ${order.address.country}`, 'UNSUPPORTED_COUNTRY');
    }
  }
}

// Pattern: Chain of Responsibility (Behavioral) – veriga 3: totalul comenzii nu depaseste limita configurata (422 AMOUNT_LIMIT_EXCEEDED)
export class AmountLimitValidator extends AbstractCheckoutValidator {
  /** @param maxTotalCents totalul maxim acceptat, in cenți (acelasi numar pentru orice moneda) */
  constructor(private readonly maxTotalCents: number) {
    super();
  }

  protected check({ order }: CheckoutContext): void {
    if (order.total.amount > this.maxTotalCents) {
      throw new DomainError(
        `Totalul comenzii (${order.total.toString()}) depaseste limita permisa de ${Money.of(this.maxTotalCents, order.total.currency).toString()}`,
        'AMOUNT_LIMIT_EXCEEDED',
      );
    }
  }
}

export interface FraudRules {
  /** Cate comenzi are voie sa plaseze un client in `windowMs` (a (N+1)-a e refuzata). */
  readonly maxOrdersPerWindow: number;
  readonly windowMs: number;
  /** Un total peste aceasta suma (in cenți) cere verificare manuala, deci comanda automata e refuzata. */
  readonly suspiciousAmountCents: number;
}

// Pattern: Chain of Responsibility (Behavioral) – veriga 4: reguli simple anti-frauda: prea multe comenzi intr-un interval scurt (429) sau suma neobisnuita (422)
export class FraudCheckValidator extends AbstractCheckoutValidator {
  constructor(
    private readonly orders: Pick<OrderRepository, 'countByCustomerSince'>,
    private readonly rules: FraudRules,
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
  }

  protected async check({ order }: CheckoutContext): Promise<void> {
    // Mesajele nu dezvaluie pragurile, ca regulile sa nu poata fi ocolite prin tatonare.
    if (order.total.amount > this.rules.suspiciousAmountCents) {
      throw new DomainError(
        'Comanda necesita verificare suplimentara si nu poate fi plasata automat',
        'ORDER_FLAGGED',
      );
    }
    const since = new Date(this.clock().getTime() - this.rules.windowMs);
    const recent = await this.orders.countByCustomerSince(order.customerId, since);
    if (recent >= this.rules.maxOrdersPerWindow) {
      throw new TooManyRequestsError(
        'Prea multe comenzi intr-un interval scurt, incearca mai tarziu',
        'ORDER_RATE_LIMITED',
      );
    }
  }
}
