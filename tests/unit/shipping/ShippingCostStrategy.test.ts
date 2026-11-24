import { describe, expect, it } from 'vitest';
import {
  ExpressShipping,
  NO_SHIPPING_RATES,
  STANDARD_SHIPPING_RATES,
  ShippingCostCalculator,
  ShippingCostStrategies,
  StandardShipping,
  StorePickup,
  type ShippingCostStrategy,
} from '../../../src/modules/shipping/domain/ShippingCostStrategy';
import { DELIVERY_METHODS } from '../../../src/modules/shipping/domain/ShippingTypes';
import { Money } from '../../../src/shared';

const ron = (cents: number) => Money.of(cents, 'RON');
const request = (cents: number, units = 1) => ({ itemsValue: ron(cents), units });

/** Strategy (B1): fiecare metoda de livrare are propriul algoritm de cost, ales la runtime. */
describe('costul livrarii (Strategy)', () => {
  describe('StandardShipping', () => {
    const standard = new StandardShipping(STANDARD_SHIPPING_RATES.standard);

    it('cost fix sub pragul de gratuitate', () => {
      expect(standard.cost(request(10_000)).amount).toBe(1_500);
      expect(standard.cost(request(29_999, 5)).amount).toBe(1_500);
    });

    it('gratuit de la pragul de valoare a marfii (inclusiv), indiferent de numarul de bucati', () => {
      expect(standard.cost(request(30_000)).amount).toBe(0);
      expect(standard.cost(request(500_000, 40)).amount).toBe(0);
    });

    it('fara prag (null) nu e niciodata gratuita', () => {
      const never = new StandardShipping({ baseCents: 700, freeFromCents: null });
      expect(never.cost(request(100_000_000)).amount).toBe(700);
    });

    it('costul e in moneda marfii', () => {
      expect(standard.cost({ itemsValue: Money.of(100, 'EUR'), units: 1 }).currency).toBe('EUR');
    });
  });

  describe('ExpressShipping', () => {
    const express = new ExpressShipping(STANDARD_SHIPPING_RATES.express);

    it('cost de baza pentru prima bucata, plus supliment pentru fiecare bucata urmatoare', () => {
      expect(express.cost(request(1_000, 1)).amount).toBe(3_000);
      expect(express.cost(request(1_000, 2)).amount).toBe(3_200);
      expect(express.cost(request(1_000, 11)).amount).toBe(5_000);
    });

    it('nu are livrare gratuita, oricat de mare e comanda', () => {
      expect(express.cost(request(10_000_000, 1)).amount).toBe(3_000);
    });
  });

  describe('StorePickup', () => {
    it('ridicarea din magazin e gratuita', () => {
      expect(new StorePickup().cost(request(999_999, 7)).amount).toBe(0);
    });
  });

  it('refuza tarife invalide si un numar invalid de bucati', () => {
    expect(() => new StandardShipping({ baseCents: -1, freeFromCents: null })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RATES' }) as Error,
    );
    expect(() => new StandardShipping({ baseCents: 1, freeFromCents: 1.5 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RATES' }) as Error,
    );
    expect(
      () => new StandardShipping({ baseCents: 2_147_483_648, freeFromCents: null }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_RATES' }) as Error);
    expect(() => new ExpressShipping({ baseCents: 1, perExtraUnitCents: -5 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RATES' }) as Error,
    );
    for (const strategy of [
      new StandardShipping(STANDARD_SHIPPING_RATES.standard),
      new ExpressShipping(STANDARD_SHIPPING_RATES.express),
      new StorePickup(),
    ]) {
      expect(() => strategy.cost(request(100, 0))).toThrowError(
        expect.objectContaining({ code: 'INVALID_QUOTE' }) as Error,
      );
    }
  });

  describe('ShippingCostCalculator (contextul)', () => {
    it('delega calculul strategiei primite, fara sa stie ce algoritm ruleaza', () => {
      const fixed: ShippingCostStrategy = { method: 'EXPRESS', cost: () => ron(4_242) };
      const calculator = new ShippingCostCalculator(fixed);

      expect(calculator.calculate(request(1))).toEqual(ron(4_242));
    });

    it('aceeasi cerere da rezultate diferite cu strategii diferite', () => {
      const basis = request(10_000, 3);
      const results = [
        new StandardShipping(STANDARD_SHIPPING_RATES.standard),
        new ExpressShipping(STANDARD_SHIPPING_RATES.express),
        new StorePickup(),
      ].map((strategy) => new ShippingCostCalculator(strategy).calculate(basis).amount);

      expect(results).toEqual([1_500, 3_400, 0]);
    });
  });

  describe('ShippingCostStrategies (alegerea la runtime dupa metoda comenzii)', () => {
    const strategies = ShippingCostStrategies.fromRates(STANDARD_SHIPPING_RATES);

    it('alege strategia potrivita pentru fiecare metoda de livrare a comenzii', () => {
      const costs = Object.fromEntries(
        DELIVERY_METHODS.map((method) => [
          method,
          strategies.calculatorFor(method).calculate(request(10_000, 2)).amount,
        ]),
      );
      expect(costs).toEqual({ STANDARD: 1_500, EXPRESS: 3_200, STORE_PICKUP: 0 });
    });

    it('tarifele fara costuri dau livrare gratuita pe toate metodele', () => {
      const free = ShippingCostStrategies.fromRates(NO_SHIPPING_RATES);
      for (const method of DELIVERY_METHODS) {
        expect(free.calculatorFor(method).calculate(request(10_000, 9)).amount).toBe(0);
      }
    });

    it('un registru incomplet sau cu strategii duplicate e refuzat la asamblare (nu cost 0 in tacere, nu eroare la runtime)', () => {
      expect(() => new ShippingCostStrategies([new StorePickup()])).toThrowError(
        expect.objectContaining({ code: 'INVALID_STRATEGIES' }) as Error,
      );
      expect(
        () =>
          new ShippingCostStrategies([
            new StorePickup(),
            new StorePickup(),
            new StandardShipping(STANDARD_SHIPPING_RATES.standard),
            new ExpressShipping(STANDARD_SHIPPING_RATES.express),
          ]),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_STRATEGIES' }) as Error);
    });
  });
});
