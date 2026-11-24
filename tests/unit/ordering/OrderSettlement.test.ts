import { beforeEach, describe, expect, it } from 'vitest';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';
import {
  PLACE_INPUT,
  admin,
  buildOrderingHarness,
  customer,
  type OrderingHarness,
} from '../../helpers/ordering-harness';

const KEYBOARD = uuid(1);

/** Portul `OrderSettlement`: operatiile de sistem pe care le cere modulul `payments` (fara principal de ADMIN). */
describe('OrderService ca OrderSettlement', () => {
  let h: OrderingHarness;
  const ana = customer(1);

  const newOrder = async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 1);
    return h.service.placeOrder(ana, PLACE_INPUT);
  };

  beforeEach(async () => {
    h = buildOrderingHarness();
    await h.products.save(makeProduct({ id: KEYBOARD, amount: 10_000, stock: 5 }));
  });

  describe('find', () => {
    it('intoarce comanda oricarui client (fara verificare de proprietar) sau null', async () => {
      const order = await newOrder();

      expect((await h.service.find(order.id))?.id).toBe(order.id);
      expect(await h.service.find(uuid(404))).toBeNull();
    });
  });

  describe('markPaid', () => {
    it('trece comanda NEW in PAID, ii seteaza paidAt si emite OrderPaid', async () => {
      const order = await newOrder();

      const paid = await h.service.markPaid(order.id);

      expect(paid.status).toBe('PAID');
      expect(paid.paidAt).toBeInstanceOf(Date);
      expect((await h.orders.findById(order.id))?.status).toBe('PAID');
      expect(h.published.map((e) => e.type)).toEqual(['OrderPlaced', 'OrderPaid']);
    });

    it('nu se poate plati de doua ori: a doua oara e tranzitie invalida (nu idempotent)', async () => {
      const order = await newOrder();
      await h.service.markPaid(order.id);

      await expect(h.service.markPaid(order.id)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
      expect(h.published.filter((e) => e.type === 'OrderPaid')).toHaveLength(1);
    });

    it('o comanda anulata nu mai poate fi platita', async () => {
      const order = await newOrder();
      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      await expect(h.service.markPaid(order.id)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
    });

    it('o comanda inexistenta este 404', async () => {
      await expect(h.service.markPaid(uuid(404))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('markRefunded', () => {
    const paidAndCancelled = async () => {
      const order = await newOrder();
      await h.service.markPaid(order.id);
      await h.service.changeStatus(admin, order.id, 'CANCELLED');
      return order;
    };

    it('trece o comanda platita si anulata in REFUNDED si emite OrderRefunded', async () => {
      const order = await paidAndCancelled();

      const refunded = await h.service.markRefunded(order.id);

      expect(refunded.status).toBe('REFUNDED');
      expect(h.published.map((e) => e.type)).toEqual([
        'OrderPlaced',
        'OrderPaid',
        'OrderCancelled',
        'OrderRefunded',
      ]);
    });

    it('este idempotent: o comanda deja rambursata ramane neschimbata si nu emite din nou', async () => {
      const order = await paidAndCancelled();
      await h.service.markRefunded(order.id);

      const again = await h.service.markRefunded(order.id);

      expect(again.status).toBe('REFUNDED');
      expect(h.published.filter((e) => e.type === 'OrderRefunded')).toHaveLength(1);
    });

    it('si cand ADMIN a marcat deja REFUNDED, apelul platilor nu esueaza', async () => {
      const order = await paidAndCancelled();
      await h.service.changeStatus(admin, order.id, 'REFUNDED');

      await expect(h.service.markRefunded(order.id)).resolves.toMatchObject({ status: 'REFUNDED' });
    });

    it.each([
      ['NEW', (id: string) => Promise.resolve(id)],
      [
        'CANCELLED fara plata',
        async (id: string) => h.service.changeStatus(admin, id, 'CANCELLED'),
      ],
    ])('o comanda %s nu se ramburseaza (nu a fost platita)', async (_name, prepare) => {
      const order = await newOrder();
      await prepare(order.id);

      await expect(h.service.markRefunded(order.id)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
    });

    it('o comanda inexistenta este 404', async () => {
      await expect(h.service.markRefunded(uuid(404))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
