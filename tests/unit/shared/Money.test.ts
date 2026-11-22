import { describe, expect, it } from 'vitest';
import { DomainError, Money } from '../../../src/shared';

describe('Money', () => {
  describe('creare', () => {
    it('stocheaza suma in cenți si moneda', () => {
      const price = Money.of(1999, 'RON');
      expect(price.amount).toBe(1999);
      expect(price.currency).toBe('RON');
    });

    it('zero() creeaza suma 0', () => {
      expect(Money.zero('EUR').isZero()).toBe(true);
    });

    it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'refuza o suma care nu e intreaga sau sigura (%s)',
      (amount) => {
        expect(() => Money.of(amount, 'RON')).toThrowError(DomainError);
      },
    );

    it('refuza o moneda nesuportata', () => {
      // @ts-expect-error testam intentionat o valoare invalida la runtime
      expect(() => Money.of(100, 'XXX')).toThrowError(/nesuportata/);
    });
  });

  describe('aritmetica', () => {
    it('aduna si scade sume in aceeasi moneda', () => {
      const a = Money.of(1000, 'RON');
      const b = Money.of(250, 'RON');
      expect(a.add(b).equals(Money.of(1250, 'RON'))).toBe(true);
      expect(a.subtract(b).equals(Money.of(750, 'RON'))).toBe(true);
    });

    it('evita erorile de virgula mobila (0.10 + 0.20 = 0.30)', () => {
      expect(Money.of(10, 'RON').add(Money.of(20, 'RON')).amount).toBe(30);
    });

    it('nu muteaza operanzii (imutabilitate)', () => {
      const a = Money.of(1000, 'RON');
      a.add(Money.of(1, 'RON'));
      expect(a.amount).toBe(1000);
    });

    it('refuza operatii intre monede diferite', () => {
      const ron = Money.of(100, 'RON');
      const eur = Money.of(100, 'EUR');
      expect(() => ron.add(eur)).toThrowError(/Monede diferite/);
      expect(() => ron.subtract(eur)).toThrowError(DomainError);
      expect(() => ron.isGreaterThan(eur)).toThrowError(DomainError);
    });

    it('permite rezultate negative la scadere', () => {
      const result = Money.of(100, 'RON').subtract(Money.of(250, 'RON'));
      expect(result.amount).toBe(-150);
      expect(result.isNegative()).toBe(true);
    });

    it('inmulteste cu o cantitate intreaga', () => {
      expect(Money.of(499, 'RON').multiply(3).amount).toBe(1497);
    });

    it('refuza inmultirea cu un numar neintreg', () => {
      expect(() => Money.of(499, 'RON').multiply(1.5)).toThrowError(DomainError);
    });

    it('negate() inverseaza semnul fara a produce -0', () => {
      expect(Money.of(100, 'RON').negate().amount).toBe(-100);
      expect(Object.is(Money.zero('RON').negate().amount, 0)).toBe(true);
    });
  });

  describe('percentage', () => {
    it('calculeaza TVA 19% din 100.00 RON', () => {
      expect(Money.of(10000, 'RON').percentage(19).amount).toBe(1900);
    });

    it('rotunjeste la cent, jumatatea in sus', () => {
      // 5% din 0.50 = 0.025 -> 0.03 (2.5 cenți -> 3)
      expect(Money.of(50, 'RON').percentage(5).amount).toBe(3);
      // 10% din 0.14 = 0.014 -> 0.01
      expect(Money.of(14, 'RON').percentage(10).amount).toBe(1);
    });

    it('rotunjeste simetric pentru sume negative', () => {
      expect(Money.of(-50, 'RON').percentage(5).amount).toBe(-3);
    });

    it('nu produce -0 cand o suma negativa mica se rotunjeste la zero', () => {
      expect(Object.is(Money.of(-1, 'RON').percentage(10).amount, 0)).toBe(true);
    });

    it('refuza un procent invalid', () => {
      expect(() => Money.of(100, 'RON').percentage(Number.NaN)).toThrowError(DomainError);
    });
  });

  describe('comparatii', () => {
    it('equals compara suma si moneda', () => {
      expect(Money.of(100, 'RON').equals(Money.of(100, 'RON'))).toBe(true);
      expect(Money.of(100, 'RON').equals(Money.of(100, 'EUR'))).toBe(false);
      expect(Money.of(100, 'RON').equals(Money.of(101, 'RON'))).toBe(false);
    });

    it('isGreaterThan / isLessThan', () => {
      const small = Money.of(100, 'RON');
      const big = Money.of(200, 'RON');
      expect(big.isGreaterThan(small)).toBe(true);
      expect(small.isLessThan(big)).toBe(true);
      expect(small.isGreaterThan(big)).toBe(false);
    });
  });

  describe('reprezentare', () => {
    it.each([
      [123450, 'RON', '1234.50 RON'],
      [5, 'EUR', '0.05 EUR'],
      [0, 'USD', '0.00 USD'],
      [-1999, 'RON', '-19.99 RON'],
    ] as const)('toString(%s %s) = %s', (amount, currency, expected) => {
      expect(Money.of(amount, currency).toString()).toBe(expected);
    });

    it('se serializeaza ca {amount, currency}', () => {
      expect(JSON.stringify(Money.of(1999, 'RON'))).toBe('{"amount":1999,"currency":"RON"}');
    });
  });
});
