import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import { Order } from '../../../src/modules/ordering/domain/Order';
import { OrderBuilder } from '../../../src/modules/ordering/domain/OrderBuilder';
import { PriceBreakdown } from '../../../src/modules/ordering/domain/pricing/PriceBreakdown';
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY as CART_MAX_QUANTITY,
} from '../../../src/modules/cart/domain/Cart';
import {
  MAX_AMOUNT_CENTS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  OrderItem,
} from '../../../src/modules/ordering/domain/OrderItem';
import { makeAddress, makeLine, makeOrder } from '../../helpers/order-fixtures';
import { uuid } from '../../helpers/ids';

describe('Order (invarianti)', () => {
  const base = () => {
    const order = makeOrder();
    return {
      id: order.id,
      customerId: order.customerId,
      items: order.items,
      address: makeAddress(),
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      price: order.price,
      createdAt: order.createdAt,
    };
  };

  it('create() porneste mereu in NEW, fara moment al platii', () => {
    const order = Order.create(base());
    expect(order.status).toBe('NEW');
    expect(order.paidAt).toBeNull();
  });

  it('refuza o comanda fara articole', () => {
    expect(() => Order.create({ ...base(), items: [] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
    );
  });

  it('refuza un pret intr-o alta moneda decat articolele', () => {
    const price = PriceBreakdown.ofSubtotal(Money.of(20_000, 'EUR'));
    expect(() => Order.create({ ...base(), price })).toThrowError(/moneda totalului/);
  });

  it('refuza un subtotal care nu corespunde liniilor', () => {
    const price = PriceBreakdown.ofSubtotal(Money.of(1, 'RON'));
    expect(() => Order.create({ ...base(), price })).toThrowError(/Subtotalul nu corespunde/);
  });

  it('expune totalul din calculul de pret', () => {
    const order = makeOrder({ pricing: { vatPercent: 19, discountTiers: [] } });
    // 2 x 100.00 = 200.00; TVA 19% = 38.00
    expect(order.price.subtotal.amount).toBe(20_000);
    expect(order.price.vat.amount).toBe(3_800);
    expect(order.total.amount).toBe(23_800);
  });

  it('refuza articole duplicate', () => {
    const line = OrderItem.create(makeLine({ itemId: uuid(1) }));
    expect(() => Order.create({ ...base(), items: [line, line] })).toThrowError(/duplicat/);
  });

  it('restore() valideaza aceleasi invariante ca create()', () => {
    expect(() => Order.restore({ ...base(), items: [], status: 'NEW', paidAt: null })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
    );
  });

  it('este imutabila: o tranzitie intoarce o comanda noua, cea veche ramane in starea ei', () => {
    const order = makeOrder();
    const paid = order.pay();
    expect(paid).not.toBe(order);
    expect(order.status).toBe('NEW');
    expect(order.paidAt).toBeNull();
    expect(paid.id).toBe(order.id);
    expect(paid.total).toBe(order.total);
  });
});

describe('limite', () => {
  const orderWith = (unitPrice: number, vatPercent: number) =>
    makeOrder({
      lines: [makeLine({ unitPrice: Money.of(unitPrice, 'RON'), quantity: 1 })],
      pricing: { vatPercent, discountTiers: [] },
    });

  it('totalul maxim e ce incape intr-un INTEGER PostgreSQL; fara TVA, subtotalul maxim trece', () => {
    expect(orderWith(MAX_AMOUNT_CENTS, 0).total.amount).toBe(MAX_AMOUNT_CENTS);
  });

  it('TVA care duce totalul peste limita e refuzat cu INVALID_ORDER, nu 500 din baza de date', () => {
    expect(() => orderWith(MAX_AMOUNT_CENTS, 19)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ORDER' }) as Error,
    );
    // Cea mai mare suma care, cu TVA 19%, mai incape: floor(MAX / 1.19) minus marja de rotunjire.
    expect(orderWith(1_800_000_000, 19).total.amount).toBeLessThanOrEqual(MAX_AMOUNT_CENTS);
  });

  it('o linie care depaseste limita fara ca subtotalul sa o depaseasca nu exista: pretul unitar e limitat', () => {
    expect(() =>
      OrderBuilder.forOrder(uuid(600)).addItem(
        makeLine({ unitPrice: Money.of(MAX_AMOUNT_CENTS + 1, 'RON'), quantity: 1 }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ORDER' }) as Error);
  });

  it('un pret unitar peste limita e refuzat la crearea liniei', () => {
    expect(() =>
      OrderItem.create(makeLine({ unitPrice: Money.of(MAX_AMOUNT_CENTS + 1, 'RON'), quantity: 1 })),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ORDER' }) as Error);
  });

  it('limitele comenzii nu sunt mai stricte decat ale cosului (un cos valid trebuie sa se poata comanda)', () => {
    expect(MAX_LINE_QUANTITY).toBeGreaterThanOrEqual(CART_MAX_QUANTITY);
    expect(MAX_ORDER_LINES).toBeGreaterThanOrEqual(MAX_CART_LINES);
  });
});

describe('OrderItem', () => {
  it('lineTotal = pret unitar x cantitate (Money, fara float)', () => {
    const item = OrderItem.create(makeLine({ unitPrice: Money.of(1_999, 'RON'), quantity: 3 }));
    expect(item.lineTotal().toString()).toBe('59.97 RON');
  });
});
