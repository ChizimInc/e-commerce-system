import { DomainError, Money } from '../../../shared';
import { DELIVERY_METHODS, type DeliveryMethod } from './ShippingTypes';

/** Ce conteaza pentru costul livrarii: valoarea marfii (inainte de reducere) si numarul de bucati (proxy pentru greutate). */
export interface ShippingCostRequest {
  readonly itemsValue: Money;
  readonly units: number;
}

// Pattern: Strategy (Behavioral) – interfata strategiei: fiecare metoda de livrare are propriul algoritm de cost, interschimbabil la runtime
export interface ShippingCostStrategy {
  readonly method: DeliveryMethod;
  cost(request: ShippingCostRequest): Money;
}

/** Tarifele magazinului, in cenți (fara moneda, ca pragurile de reducere). */
export interface ShippingRates {
  readonly standard: {
    /** Costul fix al livrarii standard. */
    readonly baseCents: number;
    /** De la aceasta valoare a marfii livrarea standard e gratuita; `null` = niciodata gratuita. */
    readonly freeFromCents: number | null;
  };
  readonly express: {
    /** Costul de baza (include primul produs). */
    readonly baseCents: number;
    /** Supliment pentru fiecare bucata dupa prima (nu avem greutate pe produse). */
    readonly perExtraUnitCents: number;
  };
}

/** Livrare gratuita: pentru teste si demo fara costuri (productia primeste `STANDARD_SHIPPING_RATES`). */
export const NO_SHIPPING_RATES: ShippingRates = {
  standard: { baseCents: 0, freeFromCents: null },
  express: { baseCents: 0, perExtraUnitCents: 0 },
};

/** Tarifele implicite ale magazinului: standard 15.00 (gratuit de la 300.00), express 30.00 + 2.00 per bucata suplimentara. */
export const STANDARD_SHIPPING_RATES: ShippingRates = {
  standard: { baseCents: 1_500, freeFromCents: 30_000 },
  express: { baseCents: 3_000, perExtraUnitCents: 200 },
};

/** Cel mai mare cuantum (in cenți) care incape intr-un INTEGER PostgreSQL: o tarifa mai mare ar face orice comanda imposibila. */
const MAX_RATE_CENTS = 2_147_483_647;

function requireCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RATE_CENTS) {
    throw new DomainError(
      `${label} trebuie sa fie un numar intreg de cenți intre 0 si ${MAX_RATE_CENTS}`,
      'INVALID_RATES',
    );
  }
  return value;
}

function requireUnits(units: number): number {
  if (!Number.isSafeInteger(units) || units < 1) {
    throw new DomainError('Numarul de bucati trebuie sa fie un numar intreg >= 1', 'INVALID_QUOTE');
  }
  return units;
}

// Pattern: Strategy (Behavioral) – strategie concreta: cost fix, gratuit de la o anumita valoare a marfii
export class StandardShipping implements ShippingCostStrategy {
  readonly method = 'STANDARD';

  constructor(private readonly rates: ShippingRates['standard']) {
    requireCents(rates.baseCents, 'Costul livrarii standard');
    if (rates.freeFromCents !== null) requireCents(rates.freeFromCents, 'Pragul de gratuitate');
  }

  cost({ itemsValue, units }: ShippingCostRequest): Money {
    requireUnits(units);
    const free = this.rates.freeFromCents !== null && itemsValue.amount >= this.rates.freeFromCents;
    return Money.of(free ? 0 : this.rates.baseCents, itemsValue.currency);
  }
}

// Pattern: Strategy (Behavioral) – strategie concreta: cost de baza plus supliment pe fiecare bucata dupa prima (proxy pentru greutate); fara livrare gratuita
export class ExpressShipping implements ShippingCostStrategy {
  readonly method = 'EXPRESS';

  constructor(private readonly rates: ShippingRates['express']) {
    requireCents(rates.baseCents, 'Costul livrarii express');
    requireCents(rates.perExtraUnitCents, 'Suplimentul per bucata');
  }

  cost({ itemsValue, units }: ShippingCostRequest): Money {
    requireUnits(units);
    return Money.of(
      this.rates.baseCents + (units - 1) * this.rates.perExtraUnitCents,
      itemsValue.currency,
    );
  }
}

// Pattern: Strategy (Behavioral) – strategie concreta: ridicarea din magazin nu costa nimic
export class StorePickup implements ShippingCostStrategy {
  readonly method = 'STORE_PICKUP';

  cost({ itemsValue, units }: ShippingCostRequest): Money {
    requireUnits(units);
    return Money.zero(itemsValue.currency);
  }
}

// Pattern: Strategy (Behavioral) – contextul: primeste strategia aleasa si ii delega calculul, fara sa stie ce algoritm ruleaza
export class ShippingCostCalculator {
  constructor(private readonly strategy: ShippingCostStrategy) {}

  calculate(request: ShippingCostRequest): Money {
    return this.strategy.cost(request);
  }
}

// Pattern: Strategy (Behavioral) – selectorul: alege la runtime strategia dupa metoda de livrare a comenzii (o metoda noua = o strategie noua inregistrata aici)
export class ShippingCostStrategies {
  private readonly byMethod: ReadonlyMap<DeliveryMethod, ShippingCostStrategy>;

  constructor(strategies: readonly ShippingCostStrategy[]) {
    const seen = new Set<DeliveryMethod>();
    for (const { method } of strategies) {
      if (seen.has(method)) {
        throw new DomainError(`Strategie duplicata pentru metoda ${method}`, 'INVALID_STRATEGIES');
      }
      seen.add(method);
    }
    // O metoda de livrare fara strategie ar da cost 0 sau eroare abia la runtime: refuzam asamblarea.
    const missing = DELIVERY_METHODS.filter((method) => !seen.has(method));
    if (missing.length > 0) {
      throw new DomainError(
        `Lipsesc strategii pentru: ${missing.join(', ')}`,
        'INVALID_STRATEGIES',
      );
    }
    this.byMethod = new Map(strategies.map((strategy) => [strategy.method, strategy]));
  }

  /** Cele trei strategii ale magazinului, cu tarifele date. */
  static fromRates(rates: ShippingRates): ShippingCostStrategies {
    return new ShippingCostStrategies([
      new StandardShipping(rates.standard),
      new ExpressShipping(rates.express),
      new StorePickup(),
    ]);
  }

  calculatorFor(method: DeliveryMethod): ShippingCostCalculator {
    const strategy = this.byMethod.get(method);
    if (!strategy) {
      throw new DomainError(`Metoda de livrare nesuportata: ${method}`, 'UNSUPPORTED_DELIVERY');
    }
    return new ShippingCostCalculator(strategy);
  }
}
