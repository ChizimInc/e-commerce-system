import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import { OrderBuilder } from '../../../src/modules/ordering/domain/OrderBuilder';
import { MAX_ORDER_LINES } from '../../../src/modules/ordering/domain/OrderItem';
import { NO_PRICE_MODIFIERS } from '../../../src/modules/ordering/domain/pricing/PricingPolicy';
import { makeAddress, makeLine } from '../../helpers/order-fixtures';
import { uuid } from '../../helpers/ids';

/** Builder (C3): constructie pas cu pas, validare la build(). */
describe('OrderBuilder', () => {
  const complete = () =>
    OrderBuilder.forOrder(uuid(500))
      .customer(uuid(900))
      .addItem(makeLine({ itemId: uuid(1), unitPrice: Money.of(10_000, 'RON'), quantity: 2 }))
      .addItem(makeLine({ itemId: uuid(2), name: 'Mouse', unitPrice: Money.of(2_550, 'RON') }))
      .shippingAddress(makeAddress())
      .delivery('EXPRESS')
      .payment('PAYPAL')
      .pricing(NO_PRICE_MODIFIERS);

  it('construieste o comanda NEW cu toate campurile si totalul calculat in Money', () => {
    const at = new Date('2026-05-06T07:08:09.000Z');
    const order = complete().placedAt(at).build();

    expect(order.id).toBe(uuid(500));
    expect(order.customerId).toBe(uuid(900));
    expect(order.status).toBe('NEW');
    expect(order.deliveryMethod).toBe('EXPRESS');
    expect(order.paymentMethod).toBe('PAYPAL');
    expect(order.address.city).toBe('Chisinau');
    expect(order.createdAt).toEqual(at);
    // 2 x 100.00 + 2 x 25.50 = 251.00
    expect(order.total.equals(Money.of(25_100, 'RON'))).toBe(true);
    expect(order.items.map((i) => i.lineTotal().amount)).toEqual([20_000, 5_100]);
  });

  it('copiaza pretul si numele in linie (instantaneu): ramane neschimbat', () => {
    const [first] = complete().build().items;
    expect(first?.name).toBe('Tastatura');
    expect(first?.unitPrice.toString()).toBe('100.00 RON');
  });

  it('addItems() adauga mai multe linii deodata (ex. cele din cos)', () => {
    const order = OrderBuilder.forOrder(uuid(501))
      .customer(uuid(900))
      .addItems([makeLine({ itemId: uuid(1) }), makeLine({ itemId: uuid(2) })])
      .shippingAddress(makeAddress())
      .delivery('STANDARD')
      .payment('CARD')
      .pricing(NO_PRICE_MODIFIERS)
      .build();
    expect(order.items).toHaveLength(2);
  });

  it('data plasarii implicita este momentul build()', () => {
    const before = Date.now();
    const order = complete().build();
    expect(order.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  describe('validare la build()', () => {
    it('refuza o comanda goala si listeaza TOT ce lipseste', () => {
      expect(() => OrderBuilder.forOrder(uuid(502)).build()).toThrowError(
        expect.objectContaining({
          code: 'INVALID_ORDER',
          message:
            'Comanda incompleta, lipsesc: clientul, articolele, adresa, metoda de livrare, metoda de plata, politica de pret',
        }) as Error,
      );
    });

    it.each([
      ['clientul', (b: OrderBuilder) => b.customer('   ')],
      ['adresa', (b: OrderBuilder) => b],
      ['metoda de livrare', (b: OrderBuilder) => b.delivery('NOPE' as 'STANDARD')],
      ['metoda de plata', (b: OrderBuilder) => b.payment('NOPE' as 'CARD')],
    ])('refuza lipsa/invaliditatea: %s', (what, tweak) => {
      const base = OrderBuilder.forOrder(uuid(503)).addItem(makeLine());
      // Pornim de la o comanda completa si stricam un singur pas.
      const builder = tweak(
        what === 'adresa'
          ? base
              .customer(uuid(900))
              .delivery('STANDARD')
              .payment('CARD')
              .pricing(NO_PRICE_MODIFIERS)
          : base
              .customer(uuid(900))
              .shippingAddress(makeAddress())
              .delivery('STANDARD')
              .payment('CARD')
              .pricing(NO_PRICE_MODIFIERS),
      );
      expect(() => builder.build()).toThrowError(
        expect.objectContaining({
          code: 'INVALID_ORDER',
          message: expect.stringContaining(what) as string,
        }) as Error,
      );
    });

    it('refuza o comanda fara politica de pret (calculul nu se poate omite din greseala)', () => {
      const builder = OrderBuilder.forOrder(uuid(508))
        .customer(uuid(900))
        .addItem(makeLine())
        .shippingAddress(makeAddress())
        .delivery('STANDARD')
        .payment('CARD');
      expect(() => builder.build()).toThrowError(/lipsesc: politica de pret/);
    });

    it('refuza o comanda fara articole', () => {
      const builder = OrderBuilder.forOrder(uuid(504))
        .customer(uuid(900))
        .shippingAddress(makeAddress())
        .delivery('STANDARD')
        .payment('CARD')
        .pricing(NO_PRICE_MODIFIERS);
      expect(() => builder.build()).toThrowError(/lipsesc: articolele/);
    });

    it('refuza monede diferite intre linii (MONEY_CURRENCY_MISMATCH)', () => {
      const builder = complete().addItem(
        makeLine({ itemId: uuid(3), unitPrice: Money.of(100, 'EUR') }),
      );
      expect(() => builder.build()).toThrowError(
        expect.objectContaining({ code: 'MONEY_CURRENCY_MISMATCH' }) as Error,
      );
    });

    it('refuza un articol duplicat', () => {
      const builder = complete().addItem(makeLine({ itemId: uuid(1) }));
      expect(() => builder.build()).toThrowError(
        expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
      );
    });

    it('refuza mai mult de MAX_ORDER_LINES articole diferite', () => {
      const builder = OrderBuilder.forOrder(uuid(505))
        .customer(uuid(900))
        .shippingAddress(makeAddress())
        .delivery('STANDARD')
        .payment('CARD')
        .pricing(NO_PRICE_MODIFIERS);
      for (let i = 1; i <= MAX_ORDER_LINES + 1; i++) builder.addItem(makeLine({ itemId: uuid(i) }));
      expect(() => builder.build()).toThrowError(
        expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
      );
    });

    it.each([0, -1, 1.5, 101])('addItem() refuza cantitatea %s (INVALID_QUANTITY)', (quantity) => {
      expect(() => OrderBuilder.forOrder(uuid(506)).addItem(makeLine({ quantity }))).toThrowError(
        expect.objectContaining({ code: 'INVALID_QUANTITY' }) as Error,
      );
    });

    it('addItem() refuza un pret negativ si un nume gol', () => {
      const builder = OrderBuilder.forOrder(uuid(507));
      expect(() => builder.addItem(makeLine({ unitPrice: Money.of(-1, 'RON') }))).toThrowError(
        /negativ/,
      );
      expect(() => builder.addItem(makeLine({ name: '  ' }))).toThrowError(/nu poate fi gol/);
    });
  });

  it('un builder nu se murdareste intre build()-uri: fiecare comanda are propria lista de articole', () => {
    const builder = complete();
    const first = builder.build();
    builder.addItem(makeLine({ itemId: uuid(9) }));
    expect(first.items).toHaveLength(2);
    expect(builder.build().items).toHaveLength(3);
  });
});
