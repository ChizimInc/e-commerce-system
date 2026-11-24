import { beforeEach, describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import type { Order } from '../../../src/modules/ordering/domain/Order';
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
const MOUSE = uuid(2);
const BUNDLE = uuid(30);

describe('OrderService', () => {
  let h: OrderingHarness;
  const ana = customer(1);
  const bob = customer(2);

  beforeEach(async () => {
    h = buildOrderingHarness();
    await h.products.save(
      makeProduct({ id: KEYBOARD, name: 'Tastatura', amount: 10_000, stock: 5 }),
    );
    await h.products.save(makeProduct({ id: MOUSE, name: 'Mouse', amount: 2_550, stock: 3 }));
  });

  describe('placeOrder', () => {
    it('creeaza comanda NEW din cos, copiaza preturile, scade stocul si goleste cosul', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      await h.cart.addItem(ana.userId, MOUSE, 1);

      const order = await h.service.placeOrder(ana, PLACE_INPUT);

      expect(order.status).toBe('NEW');
      expect(order.customerId).toBe(ana.userId);
      expect(order.items.map((i) => [i.itemId, i.name, i.unitPrice.amount, i.quantity])).toEqual([
        [KEYBOARD, 'Tastatura', 10_000, 2],
        [MOUSE, 'Mouse', 2_550, 1],
      ]);
      expect(order.total.toString()).toBe('225.50 RON');
      expect(order.address.city).toBe('Chisinau');
      expect(await h.stockOf(KEYBOARD)).toBe(3);
      expect(await h.stockOf(MOUSE)).toBe(2);
      expect((await h.cart.getCart(ana.userId)).itemCount).toBe(0);
      expect((await h.orders.findById(order.id))?.total.equals(order.total)).toBe(true);
    });

    it('pretul din comanda ramane cel de la momentul comenzii, chiar daca produsul se scumpeste', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);

      const product = await h.products.findById(KEYBOARD);
      await h.products.save(product!.withChanges({ price: Money.of(99_900, 'RON') }));

      const reloaded = await h.service.getOrder(ana, order.id);
      expect(reloaded.items[0]?.unitPrice.amount).toBe(10_000);
      expect(reloaded.total.amount).toBe(10_000);
    });

    it('un pachet consuma stocul componentelor (nu al "pachetului")', async () => {
      await h.saveBundle(BUNDLE, [
        { productId: KEYBOARD, quantity: 1 },
        { productId: MOUSE, quantity: 2 },
      ]);
      await h.cart.addItem(ana.userId, BUNDLE, 1);

      const order = await h.service.placeOrder(ana, PLACE_INPUT);

      expect(order.items[0]?.itemId).toBe(BUNDLE);
      expect(order.total.amount).toBe(10_000 + 2 * 2_550);
      expect(await h.stockOf(KEYBOARD)).toBe(4);
      expect(await h.stockOf(MOUSE)).toBe(1);
    });

    it('acelasi produs in doua linii (singur si in pachet) isi aduna consumul', async () => {
      await h.saveBundle(BUNDLE, [{ productId: MOUSE, quantity: 2 }]);
      await h.cart.addItem(ana.userId, BUNDLE, 1); // consuma 2 mouse
      await h.cart.addItem(ana.userId, MOUSE, 1); // + 1 mouse = 3 (tot stocul)

      await h.service.placeOrder(ana, PLACE_INPUT);

      expect(await h.stockOf(MOUSE)).toBe(0);
    });

    it('cos gol: 422 INVALID_ORDER, nimic nu se schimba', async () => {
      await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
        code: 'INVALID_ORDER',
      });
    });

    it('adresa invalida: INVALID_ADDRESS, cosul si stocul raman neatinse', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      await expect(
        h.service.placeOrder(ana, {
          ...PLACE_INPUT,
          address: { ...PLACE_INPUT.address, country: 'XXX' },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
      expect(await h.stockOf(KEYBOARD)).toBe(5);
      expect((await h.cart.getCart(ana.userId)).itemCount).toBe(1);
    });

    it('stoc scazut intre timp: 409 INSUFFICIENT_STOCK, fara comanda, cosul ramane', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 4);
      const product = await h.products.findById(KEYBOARD);
      await h.products.save(product!.withChanges({ stock: 1 })); // un alt client a cumparat intre timp

      await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
      });
      expect(
        (await h.orders.findByCustomerId({ customerId: ana.userId, limit: 10, offset: 0 })).total,
      ).toBe(0);
      expect(await h.stockOf(KEYBOARD)).toBe(1);
      expect((await h.cart.getCart(ana.userId)).itemCount).toBe(4);
    });

    it('un produs sters din catalog dupa adaugarea in cos nu mai apare (cosul e golit din vedere)', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      await h.products.delete(KEYBOARD);
      await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
        code: 'INVALID_ORDER',
      });
    });

    it('ultima bucata: din doua comenzi simultane ale unor clienti diferiti reuseste exact una', async () => {
      await h.products.save(makeProduct({ id: uuid(3), name: 'Rar', stock: 1 }));
      await h.cart.addItem(ana.userId, uuid(3), 1);
      await h.cart.addItem(bob.userId, uuid(3), 1);

      const results = await Promise.allSettled([
        h.service.placeOrder(ana, PLACE_INPUT),
        h.service.placeOrder(bob, PLACE_INPUT),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected');
      expect(failed).toMatchObject({ reason: { code: 'INSUFFICIENT_STOCK' } });
      expect(await h.stockOf(uuid(3))).toBe(0); // nu devine negativ (NFR4)
    });

    it('dubla trimitere a aceluiasi cos: o singura comanda, a doua cerere primeste 409 CART_CHANGED', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);

      const results = await Promise.allSettled([
        h.service.placeOrder(ana, PLACE_INPUT),
        h.service.placeOrder(ana, PLACE_INPUT),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'CART_CHANGED' },
      });
      expect(await h.stockOf(KEYBOARD)).toBe(3); // scazut o singura data
      expect(
        (await h.orders.findByCustomerId({ customerId: ana.userId, limit: 10, offset: 0 })).total,
      ).toBe(1);
    });
  });

  describe('listMyOrders / getOrder (clientul vede doar comenzile lui)', () => {
    let anaOrder: Order;
    let bobOrder: Order;

    beforeEach(async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      anaOrder = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.cart.addItem(bob.userId, MOUSE, 1);
      bobOrder = await h.service.placeOrder(bob, PLACE_INPUT);
    });

    it('istoricul contine doar comenzile apelantului', async () => {
      const page = await h.service.listMyOrders(ana, { limit: 20, offset: 0 });
      expect(page.items.map((o) => o.id)).toEqual([anaOrder.id]);
      expect(page.total).toBe(1);
      expect((await h.service.listMyOrders(bob, { limit: 20, offset: 0 })).items[0]?.id).toBe(
        bobOrder.id,
      );
    });

    it('istoricul e paginat, cele mai noi primele', async () => {
      for (let i = 0; i < 2; i++) {
        await h.cart.addItem(ana.userId, KEYBOARD, 1);
        await h.service.placeOrder(ana, PLACE_INPUT);
      }
      const all = await h.service.listMyOrders(ana, { limit: 20, offset: 0 });
      expect(all.total).toBe(3);
      const times = all.items.map((o) => o.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const second = await h.service.listMyOrders(ana, { limit: 1, offset: 1 });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).toBe(all.items[1]?.id);
      expect(second).toMatchObject({ total: 3, limit: 1, offset: 1 });
    });

    it('clientul isi vede comanda; comanda altcuiva apare ca inexistenta (404, nu 403)', async () => {
      expect((await h.service.getOrder(ana, anaOrder.id)).id).toBe(anaOrder.id);
      await expect(h.service.getOrder(ana, bobOrder.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(h.service.getOrder(ana, uuid(77))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('ADMIN poate vedea orice comanda', async () => {
      expect((await h.service.getOrder(admin, bobOrder.id)).id).toBe(bobOrder.id);
    });
  });

  describe('changeStatus (ADMIN, direct prin State)', () => {
    let order: Order;

    beforeEach(async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      order = await h.service.placeOrder(ana, PLACE_INPUT);
    });

    it('parcurge ciclul de viata NEW -> PAID -> SHIPPED -> DELIVERED si il persista', async () => {
      expect((await h.service.changeStatus(admin, order.id, 'PAID')).status).toBe('PAID');
      expect((await h.service.getOrder(ana, order.id)).paidAt).not.toBeNull();
      expect((await h.service.changeStatus(admin, order.id, 'SHIPPED')).status).toBe('SHIPPED');
      expect((await h.service.changeStatus(admin, order.id, 'DELIVERED')).status).toBe('DELIVERED');
      expect((await h.service.getOrder(ana, order.id)).status).toBe('DELIVERED');
    });

    it('o comanda platita se poate anula si apoi rambursa; una neplatita nu se ramburseaza', async () => {
      await h.service.changeStatus(admin, order.id, 'PAID');
      await h.service.changeStatus(admin, order.id, 'CANCELLED');
      expect((await h.service.changeStatus(admin, order.id, 'REFUNDED')).status).toBe('REFUNDED');

      await h.cart.addItem(ana.userId, MOUSE, 1);
      const unpaid = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, unpaid.id, 'CANCELLED');
      await expect(h.service.changeStatus(admin, unpaid.id, 'REFUNDED')).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
    });

    it('tranzitie invalida: INVALID_ORDER_TRANSITION, statusul ramane neschimbat', async () => {
      await expect(h.service.changeStatus(admin, order.id, 'SHIPPED')).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
      await expect(h.service.changeStatus(admin, order.id, 'NEW')).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
      expect((await h.service.getOrder(ana, order.id)).status).toBe('NEW');
    });

    it('clientul nu poate schimba statusul (403), nici pe comanda lui', async () => {
      await expect(h.service.changeStatus(ana, order.id, 'PAID')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect((await h.service.getOrder(ana, order.id)).status).toBe('NEW');
    });

    it('comanda inexistenta: 404', async () => {
      await expect(h.service.changeStatus(admin, uuid(77), 'PAID')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('doi admini simultan din aceeasi stare: unul reuseste, celalalt primeste 409 ORDER_CHANGED', async () => {
      await h.service.changeStatus(admin, order.id, 'PAID');
      const results = await Promise.allSettled([
        h.service.changeStatus(admin, order.id, 'SHIPPED'),
        h.service.changeStatus(admin, order.id, 'CANCELLED'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'ORDER_CHANGED' },
      });
    });
  });
});
