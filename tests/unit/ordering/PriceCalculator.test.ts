import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import { MAX_AMOUNT_CENTS, OrderItem } from '../../../src/modules/ordering/domain/OrderItem';
import { PriceBreakdown } from '../../../src/modules/ordering/domain/pricing/PriceBreakdown';
import {
  BasePrice,
  DiscountDecorator,
  ShippingDecorator,
  VatDecorator,
} from '../../../src/modules/ordering/domain/pricing/PriceCalculator';
import type { ShippingPricing } from '../../../src/modules/ordering/domain/pricing/ShippingPricing';
import {
  NO_PRICE_MODIFIERS,
  priceCalculatorFor,
} from '../../../src/modules/ordering/domain/pricing/PricingPolicy';
import { makeLine } from '../../helpers/order-fixtures';
import { uuid } from '../../helpers/ids';

const item = (amount: number, quantity = 1, n = 1) =>
  OrderItem.create(makeLine({ itemId: uuid(n), unitPrice: Money.of(amount, 'RON'), quantity }));

const TIERS = [
  { minSubtotalCents: 50_000, percent: 5 },
  { minSubtotalCents: 100_000, percent: 10 },
];

/** Decorator (S3): fiecare decorator infasoara un calculator si ii ajusteaza rezultatul. */
describe('calcul de pret (Decorator)', () => {
  describe('BasePrice', () => {
    it('subtotalul este suma liniilor, fara reducere si TVA', () => {
      const price = new BasePrice([item(10_000, 2, 1), item(2_550, 1, 2)]).calculate();
      expect(price.subtotal.amount).toBe(22_550);
      expect(price.discount.amount).toBe(0);
      expect(price.vat.amount).toBe(0);
      expect(price.total.amount).toBe(22_550);
    });

    it('refuza o lista goala si monede diferite', () => {
      expect(() => new BasePrice([]).calculate()).toThrowError(
        expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
      );
      const eur = OrderItem.create(
        makeLine({ itemId: uuid(2), unitPrice: Money.of(100, 'EUR'), quantity: 1 }),
      );
      expect(() => new BasePrice([item(100), eur]).calculate()).toThrowError(
        expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }) as Error,
      );
    });
  });

  describe('DiscountDecorator', () => {
    const discounted = (subtotal: number) =>
      new DiscountDecorator(new BasePrice([item(subtotal)]), TIERS).calculate();

    it.each([
      [49_999, 0],
      [50_000, 2_500], // pragul exact se aplica
      [99_999, 5_000],
      [100_000, 10_000], // se aplica cel mai mare prag atins, nu suma lor
      [250_000, 25_000],
    ])('subtotal %i -> reducere %i', (subtotal, discount) => {
      const price = discounted(subtotal);
      expect(price.discount.amount).toBe(discount);
      expect(price.total.amount).toBe(subtotal - discount);
    });

    it('pragurile pot fi date in orice ordine', () => {
      const price = new DiscountDecorator(
        new BasePrice([item(120_000)]),
        [...TIERS].reverse(),
      ).calculate();
      expect(price.discount.amount).toBe(12_000);
    });

    it('rotunjeste la cent (half away from zero)', () => {
      // 5% din 50.010 = 2.500,5 -> 2.501
      expect(discounted(50_010).discount.amount).toBe(2_501);
    });

    it('refuza praguri duplicate sau o reducere care scade cand suma creste', () => {
      const base = new BasePrice([item(100)]);
      const bad = [
        [
          { minSubtotalCents: 1_000, percent: 5 },
          { minSubtotalCents: 1_000, percent: 10 },
        ],
        [
          { minSubtotalCents: 1_000, percent: 10 },
          { minSubtotalCents: 5_000, percent: 5 },
        ],
        [
          { minSubtotalCents: 1_000, percent: 5 },
          { minSubtotalCents: 5_000, percent: 5 },
        ],
      ];
      for (const tiers of bad) {
        expect(() => new DiscountDecorator(base, tiers)).toThrowError(
          expect.objectContaining({ code: 'INVALID_PRICING' }) as Error,
        );
      }
    });

    it.each([
      [{ minSubtotalCents: -1, percent: 5 }],
      [{ minSubtotalCents: 1.5, percent: 5 }],
      [{ minSubtotalCents: 0, percent: 0 }],
      [{ minSubtotalCents: 0, percent: 101 }],
      [{ minSubtotalCents: 0, percent: Number.NaN }],
    ])('refuza un prag invalid %j', (tier) => {
      expect(() => new DiscountDecorator(new BasePrice([item(100)]), [tier])).toThrowError(
        expect.objectContaining({ code: 'INVALID_PRICING' }) as Error,
      );
    });
  });

  describe('VatDecorator', () => {
    it('adauga TVA pe subtotal', () => {
      const price = new VatDecorator(new BasePrice([item(10_000, 2)]), 19).calculate();
      expect(price.vat.amount).toBe(3_800);
      expect(price.total.amount).toBe(23_800);
    });

    it('rotunjeste la cent', () => {
      // 19% din 1,05 = 0,1995 -> 0,20
      expect(new VatDecorator(new BasePrice([item(105)]), 19).calculate().vat.amount).toBe(20);
    });

    it.each([-1, 100.5, Number.NaN, Number.POSITIVE_INFINITY])('refuza cota %s', (rate) => {
      expect(() => new VatDecorator(new BasePrice([item(100)]), rate)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PRICING' }) as Error,
      );
    });
  });

  describe('decoratorii se compun', () => {
    it('TVA se calculeaza pe subtotalul DUPA reducere: total = subtotal - reducere + TVA', () => {
      const calculator = new VatDecorator(
        new DiscountDecorator(new BasePrice([item(100_000)]), TIERS),
        19,
      );
      const price = calculator.calculate();
      expect(price.subtotal.amount).toBe(100_000);
      expect(price.discount.amount).toBe(10_000);
      expect(price.vat.amount).toBe(17_100); // 19% din 90.000
      expect(price.total.amount).toBe(107_100);
    });

    it('ordinea decoratorilor conteaza (TVA pe subtotal intreg ar da alt rezultat)', () => {
      const vatFirst = new DiscountDecorator(
        new VatDecorator(new BasePrice([item(100_000)]), 19),
        TIERS,
      ).calculate();
      // TVA s-a calculat inainte de reducere: 19% din 100.000 = 19.000
      expect(vatFirst.vat.amount).toBe(19_000);
      expect(vatFirst.total.amount).toBe(109_000);
    });
  });

  describe('priceCalculatorFor (politica din configurare)', () => {
    it('fara modificatori, totalul este suma liniilor', () => {
      const price = priceCalculatorFor(
        [item(10_000, 3)],
        NO_PRICE_MODIFIERS,
        'STANDARD',
      ).calculate();
      expect(price.total.amount).toBe(30_000);
    });

    it('aplica reducerea, apoi TVA', () => {
      const price = priceCalculatorFor(
        [item(60_000)],
        { vatPercent: 19, discountTiers: TIERS },
        'STANDARD',
      ).calculate();
      expect(price.discount.amount).toBe(3_000);
      expect(price.vat.amount).toBe(10_830); // 19% din 57.000
      expect(price.total.amount).toBe(67_830);
    });

    it('doar TVA sau doar reduceri, dupa configurare', () => {
      expect(
        priceCalculatorFor(
          [item(60_000)],
          { vatPercent: 0, discountTiers: TIERS },
          'STANDARD',
        ).calculate().vat.amount,
      ).toBe(0);
      expect(
        priceCalculatorFor(
          [item(60_000)],
          { vatPercent: 19, discountTiers: [] },
          'STANDARD',
        ).calculate().discount.amount,
      ).toBe(0);
    });

    it('un calcul care depaseste INTEGER-ul din baza de date e refuzat cu INVALID_ORDER (nu 500)', () => {
      expect(() =>
        priceCalculatorFor(
          [item(MAX_AMOUNT_CENTS)],
          { vatPercent: 19, discountTiers: [] },
          'STANDARD',
        ).calculate(),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ORDER' }) as Error);
    });
  });
});

describe('PriceBreakdown', () => {
  const ron = (n: number) => Money.of(n, 'RON');

  it('total = subtotal - reducere + TVA', () => {
    const price = PriceBreakdown.of({ subtotal: ron(1_000), discount: ron(100), vat: ron(171) });
    expect(price.total.amount).toBe(1_071);
  });

  it('refuza reducere peste subtotal, sume negative si sume peste limita INTEGER', () => {
    expect(() =>
      PriceBreakdown.of({ subtotal: ron(100), discount: ron(101), vat: ron(0) }),
    ).toThrowError(/Reducerea nu poate depasi/);
    expect(() => PriceBreakdown.ofSubtotal(ron(-1))).toThrowError(/negativ/);
    expect(() => PriceBreakdown.ofSubtotal(ron(MAX_AMOUNT_CENTS + 1))).toThrowError(
      /depaseste limita/,
    );
    // subtotalul si reducerea incap, dar totalul cu TVA nu
    expect(() =>
      PriceBreakdown.of({ subtotal: ron(MAX_AMOUNT_CENTS), discount: ron(0), vat: ron(1) }),
    ).toThrowError(/Totalul comenzii depaseste limita/);
  });

  it('restore() accepta valori consistente si refuza un total care nu corespunde partilor', () => {
    const parts = { subtotal: ron(1_000), discount: ron(100), vat: ron(171) };
    expect(PriceBreakdown.restore({ ...parts, total: ron(1_071) }).total.amount).toBe(1_071);
    expect(() => PriceBreakdown.restore({ ...parts, total: ron(1_000) })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
    );
  });

  it('refuza monede diferite intre parti', () => {
    expect(() =>
      PriceBreakdown.of({ subtotal: ron(100), discount: Money.of(0, 'EUR'), vat: ron(0) }),
    ).toThrowError(expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }) as Error);
  });
});

/** Decorator (S3): costul livrarii se adauga dupa reducere si inainte de TVA, iar invariantele (cenți, INTEGER) raman. */
describe('livrarea in total (ShippingDecorator)', () => {
  const ron = (n: number) => Money.of(n, 'RON');
  /** Livrare fixa pentru orice comanda: izoleaza decoratorul de strategiile din `shipping`. */
  const flat = (cents: number): ShippingPricing => ({ costFor: () => ron(cents) });

  it('total = subtotal - reducere + livrare + TVA; TVA se aplica si pe livrare', () => {
    const price = new VatDecorator(
      new ShippingDecorator(
        new DiscountDecorator(new BasePrice([item(60_000)]), TIERS),
        flat(1_500),
        { method: 'STANDARD', units: 1 },
      ),
      19,
    ).calculate();

    expect(price.discount.amount).toBe(3_000); // 5% din 600.00
    expect(price.shipping.amount).toBe(1_500);
    expect(price.vat.amount).toBe(11_115); // 19% din (57.000 + 1.500)
    expect(price.total.amount).toBe(60_000 - 3_000 + 1_500 + 11_115);
  });

  it('cere costul portului cu metoda comenzii, valoarea marfii inainte de reducere si numarul de bucati', () => {
    const seen: unknown[] = [];
    const pricing: ShippingPricing = {
      costFor: (request) => {
        seen.push(request);
        return ron(0);
      },
    };

    new ShippingDecorator(new DiscountDecorator(new BasePrice([item(60_000, 3)]), TIERS), pricing, {
      method: 'EXPRESS',
      units: 3,
    }).calculate();

    expect(seen).toEqual([{ deliveryMethod: 'EXPRESS', itemsValue: ron(180_000), units: 3 }]);
  });

  it('priceCalculatorFor include livrarea cu metoda comenzii, doar daca politica are un calcul de livrare', () => {
    const policy = { vatPercent: 0, discountTiers: [] };
    const byMethod: ShippingPricing = {
      costFor: ({ deliveryMethod, units }) => ron(deliveryMethod === 'EXPRESS' ? 100 * units : 0),
    };

    const express = priceCalculatorFor(
      [item(1_000, 3)],
      { ...policy, shipping: byMethod },
      'EXPRESS',
    ).calculate();
    const pickup = priceCalculatorFor(
      [item(1_000, 3)],
      { ...policy, shipping: byMethod },
      'STORE_PICKUP',
    ).calculate();
    const unpriced = priceCalculatorFor([item(1_000, 3)], policy, 'EXPRESS').calculate();

    expect([express.shipping.amount, express.total.amount]).toEqual([300, 3_300]);
    expect([pickup.shipping.amount, pickup.total.amount]).toEqual([0, 3_000]);
    expect([unpriced.shipping.amount, unpriced.total.amount]).toEqual([0, 3_000]);
  });

  it('o livrare care ar depasi limita INTEGER a totalului e refuzata cu INVALID_ORDER (nu 500)', () => {
    expect(() =>
      new ShippingDecorator(new BasePrice([item(MAX_AMOUNT_CENTS)]), flat(1), {
        method: 'STANDARD',
        units: 1,
      }).calculate(),
    ).toThrowError(/Totalul comenzii depaseste limita/);
  });

  it('refuza un cost de livrare negativ, peste limita sau in alta moneda', () => {
    const calc = (cost: Money) =>
      new ShippingDecorator(
        new BasePrice([item(1_000)]),
        { costFor: () => cost },
        {
          method: 'STANDARD',
          units: 1,
        },
      ).calculate();

    expect(() => calc(ron(-1))).toThrowError(/Costul livrarii comenzii nu poate fi negativ/);
    expect(() => calc(ron(MAX_AMOUNT_CENTS + 1))).toThrowError(/depaseste limita/);
    expect(() => calc(Money.of(10, 'EUR'))).toThrowError(
      expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }) as Error,
    );
  });

  describe('PriceBreakdown cu livrare', () => {
    it('total include livrarea; fara livrare data, aceasta e 0 (comenzile vechi raman valide)', () => {
      const withShipping = PriceBreakdown.of({
        subtotal: ron(1_000),
        discount: ron(100),
        shipping: ron(150),
        vat: ron(200),
      });
      expect(withShipping.total.amount).toBe(1_250);
      expect(withShipping.taxableAmount().amount).toBe(1_050);
      expect(
        PriceBreakdown.of({ subtotal: ron(1_000), discount: ron(0), vat: ron(0) }).shipping.amount,
      ).toBe(0);
    });

    it('restore() verifica ca totalul include livrarea', () => {
      const parts = { subtotal: ron(1_000), discount: ron(100), shipping: ron(150), vat: ron(200) };
      expect(PriceBreakdown.restore({ ...parts, total: ron(1_250) }).shipping.amount).toBe(150);
      expect(() => PriceBreakdown.restore({ ...parts, total: ron(1_100) })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
      );
    });

    it('withShipping pastreaza celelalte parti', () => {
      const price = PriceBreakdown.of({
        subtotal: ron(1_000),
        discount: ron(100),
        vat: ron(0),
      }).withShipping(ron(50));
      expect([price.subtotal.amount, price.discount.amount, price.total.amount]).toEqual([
        1_000, 100, 950,
      ]);
    });
  });
});
