import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import { Order } from '../../../src/modules/ordering/domain/Order';
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
      total: order.total,
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

  it('refuza un total negativ', () => {
    expect(() => Order.create({ ...base(), total: Money.of(-1, 'RON') })).toThrowError(/negativ/);
  });

  it('refuza un total intr-o alta moneda decat articolele', () => {
    expect(() => Order.create({ ...base(), total: Money.of(100, 'EUR') })).toThrowError(
      /moneda totalului/,
    );
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
  it('totalul maxim e ce incape intr-un INTEGER PostgreSQL; peste el: INVALID_ORDER, nu 500 din baza de date', () => {
    const base = makeOrder();
    const props = {
      id: base.id,
      customerId: base.customerId,
      items: base.items,
      address: makeAddress(),
      deliveryMethod: base.deliveryMethod,
      paymentMethod: base.paymentMethod,
      createdAt: base.createdAt,
    };
    expect(() =>
      Order.create({ ...props, total: Money.of(MAX_AMOUNT_CENTS, 'RON') }),
    ).not.toThrow();
    expect(() =>
      Order.create({ ...props, total: Money.of(MAX_AMOUNT_CENTS + 1, 'RON') }),
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
