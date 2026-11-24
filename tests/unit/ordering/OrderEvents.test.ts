import { beforeEach, describe, expect, it } from 'vitest';
import { ConsoleLogger, InMemoryEventBus, type EventBus } from '../../../src/shared';
import { OrderEventLogger } from '../../../src/modules/ordering/application/OrderEventLogger';
import { InMemoryStockRestoration } from '../../../src/modules/ordering/adapters/persistence/InMemoryStockRestoration';
import { RestockOnOrderCancelled } from '../../../src/modules/ordering/application/RestockOnOrderCancelled';
import {
  eventForOrder,
  ORDER_EVENT_TYPES,
  type OrderCancelled,
  type OrderEvent,
} from '../../../src/modules/ordering/domain/events/OrderEvents';
import type { OrderCatalog } from '../../../src/modules/ordering/ports/out/OrderCatalog';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';
import { makeOrder } from '../../helpers/order-fixtures';
import {
  PLACE_INPUT,
  admin,
  buildOrderingHarness,
  customer,
  type OrderingHarness,
} from '../../helpers/ordering-harness';
import { silentLogger } from '../../helpers/silent-logger';

const KEYBOARD = uuid(1);
const MOUSE = uuid(2);
const BUNDLE = uuid(30);

describe('evenimentele comenzii', () => {
  describe('eventForOrder (cate un eveniment per stare)', () => {
    const at = new Date('2026-06-01T10:00:00.000Z');

    it.each([
      ['NEW', (o: ReturnType<typeof makeOrder>) => o, 'OrderPlaced'],
      ['PAID', (o: ReturnType<typeof makeOrder>) => o.pay(), 'OrderPaid'],
      ['SHIPPED', (o: ReturnType<typeof makeOrder>) => o.pay().ship(), 'OrderShipped'],
      [
        'DELIVERED',
        (o: ReturnType<typeof makeOrder>) => o.pay().ship().deliver(),
        'OrderDelivered',
      ],
      ['CANCELLED', (o: ReturnType<typeof makeOrder>) => o.cancel(), 'OrderCancelled'],
    ])('%s -> %s', (_status, to, type) => {
      const order = to(makeOrder());
      expect(eventForOrder(order, at)).toMatchObject({
        type,
        orderId: order.id,
        customerId: order.customerId,
        occurredAt: at,
        items: [{ itemId: uuid(1), quantity: 2 }],
      });
    });

    it('REFUNDED emite OrderRefunded (rambursarea vine din modulul payments)', () => {
      const order = makeOrder().pay().cancel().refund();
      expect(eventForOrder(order, at)).toMatchObject({ type: 'OrderRefunded', orderId: order.id });
    });

    it('OrderCancelled spune daca comanda fusese platita', () => {
      expect((eventForOrder(makeOrder().cancel(), at) as OrderCancelled).wasPaid).toBe(false);
      expect((eventForOrder(makeOrder().pay().cancel(), at) as OrderCancelled).wasPaid).toBe(true);
    });

    it('nu poarta date personale (adresa, nume de destinatar) si acopera toate tipurile declarate', () => {
      const event = eventForOrder(makeOrder(), at);
      expect(JSON.stringify(event)).not.toMatch(/Ana Popescu|Libertatii|Chisinau|MD-2001/);
      expect(ORDER_EVENT_TYPES).toHaveLength(6);
    });
  });

  describe('emiterea la tranzitiile de stare (OrderService)', () => {
    let h: OrderingHarness;
    const ana = customer(1);

    beforeEach(async () => {
      h = buildOrderingHarness();
      await h.products.save(
        makeProduct({ id: KEYBOARD, name: 'Tastatura', amount: 10_000, stock: 5 }),
      );
      await h.products.save(makeProduct({ id: MOUSE, name: 'Mouse', amount: 2_550, stock: 3 }));
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
    });

    it('plasarea emite OrderPlaced, iar fiecare tranzitie emite evenimentul ei, in ordine', async () => {
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'PAID');
      await h.service.changeStatus(admin, order.id, 'SHIPPED');
      await h.service.changeStatus(admin, order.id, 'DELIVERED');

      expect(h.published.map((e) => e.type)).toEqual([
        'OrderPlaced',
        'OrderPaid',
        'OrderShipped',
        'OrderDelivered',
      ]);
      expect(h.published.every((e) => e.orderId === order.id)).toBe(true);
    });

    it('anularea emite OrderCancelled, iar rambursarea OrderRefunded', async () => {
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'PAID');
      await h.service.changeStatus(admin, order.id, 'CANCELLED');
      await h.service.changeStatus(admin, order.id, 'REFUNDED');

      expect(h.published.map((e) => e.type)).toEqual([
        'OrderPlaced',
        'OrderPaid',
        'OrderCancelled',
        'OrderRefunded',
      ]);
      expect(h.published[2]).toMatchObject({ wasPaid: true });
    });

    it('evenimentul se emite DUPA salvare: abonatul vede deja noua stare in repository', async () => {
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      const seenInStore: string[] = [];
      h.events.subscribe<OrderEvent>('OrderPaid', async (event) => {
        seenInStore.push((await h.orders.findById(event.orderId))?.status ?? 'lipsa');
      });

      await h.service.changeStatus(admin, order.id, 'PAID');

      expect(seenInStore).toEqual(['PAID']);
    });

    it('un eveniment nu se emite cand plasarea sau tranzitia esueaza', async () => {
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      h.published.length = 0;

      await expect(h.service.changeStatus(admin, order.id, 'DELIVERED')).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
      await expect(h.service.changeStatus(admin, uuid(77), 'PAID')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        h.service.placeOrder(ana, PLACE_INPUT), // cosul e gol acum
      ).rejects.toMatchObject({ code: 'INVALID_ORDER' });

      expect(h.published).toEqual([]);
    });

    it('doi admini simultan: evenimentul se emite doar pentru tranzitia care a reusit', async () => {
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'PAID');
      h.published.length = 0;

      await Promise.allSettled([
        h.service.changeStatus(admin, order.id, 'SHIPPED'),
        h.service.changeStatus(admin, order.id, 'CANCELLED'),
      ]);

      expect(h.published).toHaveLength(1);
    });

    it('un abonat care esueaza nu strica comanda si nu opreste ceilalti abonati', async () => {
      h.events.subscribe<OrderEvent>('OrderPlaced', () => {
        throw new Error('abonat stricat');
      });
      const reached: string[] = [];
      h.events.subscribe<OrderEvent>('OrderPlaced', () => {
        reached.push('urmatorul abonat');
      });

      const order = await h.service.placeOrder(ana, PLACE_INPUT);

      expect(order.status).toBe('NEW');
      expect((await h.orders.findById(order.id))?.status).toBe('NEW');
      expect(reached).toEqual(['urmatorul abonat']);
      expect(await h.stockOf(KEYBOARD)).toBe(3);
    });

    it('o magistrala care respinge publish() nu strica nici ea comanda (garda din serviciu)', async () => {
      const broken: EventBus = {
        publish: () => Promise.reject(new Error('bus cazut')),
        subscribe: () => () => undefined,
      };
      const h2 = buildOrderingHarness({ events: broken });
      await h2.products.save(makeProduct({ id: KEYBOARD, name: 'Tastatura', stock: 5 }));
      await h2.cart.addItem(ana.userId, KEYBOARD, 1);

      const order = await h2.service.placeOrder(ana, PLACE_INPUT);
      expect((await h2.orders.findById(order.id))?.status).toBe('NEW');

      await h2.service.changeStatus(admin, order.id, 'PAID');
      expect((await h2.orders.findById(order.id))?.status).toBe('PAID');
    });
  });

  /** Observer (B3), abonat real: anularea repune stocul (rezolva limitarea din partea A). */
  describe('RestockOnOrderCancelled (abonat real la OrderCancelled)', () => {
    let h: OrderingHarness;
    const ana = customer(1);

    beforeEach(async () => {
      h = buildOrderingHarness();
      await h.products.save(
        makeProduct({ id: KEYBOARD, name: 'Tastatura', amount: 10_000, stock: 5 }),
      );
      await h.products.save(makeProduct({ id: MOUSE, name: 'Mouse', amount: 2_550, stock: 3 }));
    });

    it('anularea unei comenzi neplatite repune stocul', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      expect(await h.stockOf(KEYBOARD)).toBe(3);

      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });

    it('anularea unei comenzi platite repune stocul; rambursarea ulterioara nu il repune iar', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'PAID');
      await h.service.changeStatus(admin, order.id, 'CANCELLED');
      expect(await h.stockOf(KEYBOARD)).toBe(5);

      await h.service.changeStatus(admin, order.id, 'REFUNDED');

      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });

    it('un pachet repune stocul COMPONENTELOR (prin stockRequirements), nu al "pachetului"', async () => {
      await h.saveBundle(BUNDLE, [
        { productId: KEYBOARD, quantity: 1 },
        { productId: MOUSE, quantity: 2 },
      ]);
      await h.cart.addItem(ana.userId, BUNDLE, 1);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      expect([await h.stockOf(KEYBOARD), await h.stockOf(MOUSE)]).toEqual([4, 1]);

      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      expect([await h.stockOf(KEYBOARD), await h.stockOf(MOUSE)]).toEqual([5, 3]);
    });

    it('acelasi produs in doua linii (singur si in pachet) isi aduna repunerea', async () => {
      await h.saveBundle(BUNDLE, [{ productId: MOUSE, quantity: 2 }]);
      await h.cart.addItem(ana.userId, BUNDLE, 1); // 2 mouse
      await h.cart.addItem(ana.userId, MOUSE, 1); // + 1 mouse
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      expect(await h.stockOf(MOUSE)).toBe(0);

      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      expect(await h.stockOf(MOUSE)).toBe(3);
    });

    it('IDEMPOTENT: aceeasi anulare procesata de doua ori repune stocul o singura data', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'CANCELLED');
      const cancelled = h.published.find((e): e is OrderCancelled => e.type === 'OrderCancelled');
      expect(cancelled).toBeDefined();

      // Reluarea evenimentului (livrare dubla, reincercare) si livrari concurente.
      await h.events.publish(cancelled as OrderCancelled);
      await Promise.all([
        h.restock.handle(cancelled as OrderCancelled),
        h.restock.handle(cancelled as OrderCancelled),
      ]);

      expect(await h.stockOf(KEYBOARD)).toBe(5); // nu 7, 9 sau 11
    });

    it('doua comenzi anulate repun fiecare stocul ei (idempotenta e pe comanda)', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const first = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.cart.addItem(ana.userId, KEYBOARD, 1);
      const second = await h.service.placeOrder(ana, PLACE_INPUT);
      expect(await h.stockOf(KEYBOARD)).toBe(2);

      await h.service.changeStatus(admin, first.id, 'CANCELLED');
      await h.service.changeStatus(admin, second.id, 'CANCELLED');

      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });

    it('o tranzitie respinsa (a doua anulare) nu emite eveniment si nu repune nimic', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      await expect(h.service.changeStatus(admin, order.id, 'CANCELLED')).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });

      expect(h.published.filter((e) => e.type === 'OrderCancelled')).toHaveLength(1);
      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });

    it('comenzile care nu se anuleaza nu ating stocul', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.service.changeStatus(admin, order.id, 'PAID');
      await h.service.changeStatus(admin, order.id, 'SHIPPED');
      await h.service.changeStatus(admin, order.id, 'DELIVERED');
      expect(await h.stockOf(KEYBOARD)).toBe(3);
    });

    it('un produs sters intre timp e sarit, ceilalti se repun', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      await h.cart.addItem(ana.userId, MOUSE, 1);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.products.delete(KEYBOARD);

      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      expect(await h.stockOf(MOUSE)).toBe(3);
    });

    it('stocul repus nu depaseste maximul din catalog (produsul ramane citibil)', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      const product = await h.products.findById(KEYBOARD);
      await h.products.save(product!.withChanges({ stock: 999_999 })); // admin a reaprovizionat intre timp

      await h.service.changeStatus(admin, order.id, 'CANCELLED');

      expect(await h.stockOf(KEYBOARD)).toBe(1_000_000);
    });

    it('un esec la mijlocul repunerii nu lasa stoc partial si nu marcheaza comanda: reluarea aplica repunerea o singura data', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      await h.cart.addItem(ana.userId, MOUSE, 1);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      expect([await h.stockOf(KEYBOARD), await h.stockOf(MOUSE)]).toEqual([3, 2]);

      // Un depozit care esueaza la a doua scriere (dupa ce prima a reusit).
      let writes = 0;
      const flaky = Object.create(h.products) as typeof h.products;
      flaky.save = (product) => {
        if (++writes === 2) return Promise.reject(new Error('scriere esuata'));
        return h.products.save(product);
      };
      const failing = new InMemoryStockRestoration(flaky);
      const stock = [
        { productId: KEYBOARD, quantity: 2 },
        { productId: MOUSE, quantity: 1 },
      ];

      await expect(failing.restore(order.id, stock)).rejects.toThrowError('scriere esuata');
      expect([await h.stockOf(KEYBOARD), await h.stockOf(MOUSE)]).toEqual([3, 2]); // nimic partial

      expect(await failing.restore(order.id, stock)).toBe(true); // reluarea merge
      expect([await h.stockOf(KEYBOARD), await h.stockOf(MOUSE)]).toEqual([5, 3]);
      expect(await failing.restore(order.id, stock)).toBe(false);
    });

    it('un esec la citirea catalogului se propaga din handler (bus-ul il logheaza) fara sa marcheze comanda', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      const failingCatalog: OrderCatalog = {
        find: () => Promise.reject(new Error('catalog cazut')),
      };
      const bus = new InMemoryEventBus(silentLogger);
      new RestockOnOrderCancelled(failingCatalog, h.restoration, silentLogger).register(bus);
      const cancelled: OrderCancelled = {
        type: 'OrderCancelled',
        occurredAt: new Date(),
        orderId: order.id,
        customerId: ana.userId,
        total: order.total,
        items: [{ itemId: KEYBOARD, quantity: 2 }],
        wasPaid: false,
      };

      await expect(bus.publish(cancelled)).resolves.toBeUndefined();
      expect(await h.stockOf(KEYBOARD)).toBe(3);
      // Comanda nu a fost marcata: o procesare ulterioara (catalog revenit) repune stocul.
      await h.restock.handle(cancelled);
      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });

    it('daca toate articolele au disparut din catalog nu se marcheaza nimic (nu exista stoc de repus)', async () => {
      await h.cart.addItem(ana.userId, KEYBOARD, 2);
      const order = await h.service.placeOrder(ana, PLACE_INPUT);
      await h.products.delete(KEYBOARD);
      const cancelled: OrderCancelled = {
        type: 'OrderCancelled',
        occurredAt: new Date(),
        orderId: order.id,
        customerId: ana.userId,
        total: order.total,
        items: [{ itemId: KEYBOARD, quantity: 2 }],
        wasPaid: false,
      };

      await h.restock.handle(cancelled);

      // Produsul reapare (restaurat de admin): repunerea inca se poate aplica, comanda nu fusese marcata.
      await h.products.save(makeProduct({ id: KEYBOARD, name: 'Tastatura', stock: 3 }));
      await h.restock.handle(cancelled);
      expect(await h.stockOf(KEYBOARD)).toBe(5);
    });
  });

  describe('OrderEventLogger (abonat care logheaza, fara date personale)', () => {
    it('logheaza fiecare eveniment cu id-ul comenzii si totalul, dar fara adresa, nume sau client', async () => {
      const lines: string[] = [];
      const logger = new ConsoleLogger('info', {}, (_level, line) => lines.push(line));
      const bus = new InMemoryEventBus(silentLogger);
      new OrderEventLogger(logger).register(bus);
      const order = makeOrder();

      for (const type of ORDER_EVENT_TYPES) {
        const base = eventForOrder(order, new Date()) as OrderEvent;
        await bus.publish({ ...base, type });
      }

      expect(lines).toHaveLength(ORDER_EVENT_TYPES.length);
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entries.map((e) => e['eventType'])).toEqual([...ORDER_EVENT_TYPES]);
      for (const entry of entries) {
        expect(entry).toMatchObject({ orderId: order.id, total: '200.00 RON', itemCount: 1 });
      }
      const text = lines.join('\n');
      expect(text).not.toContain(order.customerId);
      expect(text).not.toMatch(/Ana Popescu|Libertatii|Chisinau|MD-2001|Tastatura/);
    });
  });
});
