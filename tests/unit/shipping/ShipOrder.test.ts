import { beforeEach, describe, expect, it } from 'vitest';
import {
  CourierProviderError,
  CourierRejectedError,
  CourierTimeoutError,
} from '../../../src/modules/shipping/domain/errors';
import { STALE_PENDING_MS } from '../../../src/modules/shipping/application/ShipOrder';
import { Shipment } from '../../../src/modules/shipping/domain/Shipment';
import { ConflictError, DomainError, Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';
import {
  admin,
  buildShippingHarness,
  owner,
  START,
  type ShippingHarness,
} from '../../helpers/shipping-harness';

const ORDER = uuid(1);

describe('ShipOrder (expedierea unei comenzi platite)', () => {
  let h: ShippingHarness;

  beforeEach(() => {
    h = buildShippingHarness();
    h.newOrder(1);
  });

  describe('expediere reusita', () => {
    it('preda coletul curierului, salveaza livrarea CREATED, trece comanda in SHIPPED', async () => {
      const shipment = await h.shipOrder.execute(admin, ORDER);

      expect(shipment).toMatchObject({
        orderId: ORDER,
        courier: 'FAST_COURIER',
        status: 'CREATED',
        externalId: 'FC-1',
        trackingNumber: 'TRK-FC-1',
        failureReason: null,
      });
      expect(shipment.cost.toJSON()).toEqual({ amount: 3_200, currency: 'RON' });
      expect(h.orders.shipped).toEqual([ORDER]);
      expect(h.orders.orders.get(ORDER)?.state).toBe('SHIPPED');
      expect(await h.shipments.findByOrderId(ORDER)).toEqual(shipment);
    });

    it('trimite curierului destinatarul, numarul de bucati, valoarea declarata (totalul) si o cheie de idempotenta pe comanda', async () => {
      await h.shipOrder.execute(admin, ORDER);

      expect(h.services.FAST_COURIER.created).toEqual([
        {
          reference: ORDER,
          recipient: {
            name: 'Ana Popescu',
            street: 'Str. Libertatii 10',
            city: 'Chisinau',
            postalCode: 'MD-2001',
            country: 'MD',
          },
          units: 2,
          declaredValue: Money.of(10_000, 'RON'),
          idempotencyKey: `ship:${ORDER}`,
        },
      ]);
    });

    it.each([
      ['STANDARD', 'POST_OFFICE'],
      ['EXPRESS', 'FAST_COURIER'],
      ['STORE_PICKUP', 'STORE_PICKUP'],
    ] as const)('metoda de livrare %s alege curierul %s', async (deliveryMethod, courier) => {
      h.newOrder(2, { deliveryMethod });

      const shipment = await h.shipOrder.execute(admin, uuid(2));

      expect(shipment.courier).toBe(courier);
      expect(h.services[courier].created).toHaveLength(1);
      for (const other of Object.values(h.services).filter((s) => s !== h.services[courier])) {
        expect(other.created).toHaveLength(0);
      }
    });

    it('livrarea pastreaza costul calculat la plasarea comenzii (nu un cost recalculat)', async () => {
      h.newOrder(3, { shippingCost: Money.of(0, 'RON'), deliveryMethod: 'STORE_PICKUP' });
      expect((await h.shipOrder.execute(admin, uuid(3))).cost.amount).toBe(0);
    });
  });

  describe('autorizare si stare', () => {
    it('doar ADMIN expediaza: un CUSTOMER (nici macar proprietarul) primeste Forbidden, fara apel la curier', async () => {
      await expect(h.shipOrder.execute(owner, ORDER)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(h.services.FAST_COURIER.created).toHaveLength(0);
      expect(h.orders.shipped).toEqual([]);
    });

    it('o comanda inexistenta e NotFound', async () => {
      await expect(h.shipOrder.execute(admin, uuid(404))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('o comanda neplatita, anulata sau rambursata nu se expediaza (ORDER_NOT_SHIPPABLE), fara livrare si fara curier', async () => {
      h.orders.setState(ORDER, 'NOT_SHIPPABLE');

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'ORDER_NOT_SHIPPABLE',
      });
      expect(h.services.FAST_COURIER.created).toHaveLength(0);
      expect(await h.shipments.findByOrderId(ORDER)).toBeNull();
    });

    it('a doua expediere a aceleiasi comenzi e refuzata (ORDER_ALREADY_SHIPPED): un singur colet', async () => {
      await h.shipOrder.execute(admin, ORDER);

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_SHIPPED',
      });
      expect(h.services.FAST_COURIER.created).toHaveLength(1);
    });

    it('cereri simultane pe aceeasi comanda: exact una ajunge la curier, restul primesc 409', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => h.shipOrder.execute(admin, ORDER)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(7);
      for (const { reason } of rejected) expect(reason).toBeInstanceOf(ConflictError);
      expect(h.services.FAST_COURIER.created).toHaveLength(1);
      expect(h.orders.shipped).toEqual([ORDER]);
    });

    it('o livrare PENDING abandonata (cerere veche) se reia: curierul e apelat, comanda devine SHIPPED', async () => {
      await h.shipments.insert(
        Shipment.start({
          id: uuid(71),
          orderId: ORDER,
          courier: 'FAST_COURIER',
          cost: Money.of(3_200, 'RON'),
          now: START,
        }),
      );
      h.advance(STALE_PENDING_MS);

      const shipment = await h.shipOrder.execute(admin, ORDER);

      expect(shipment).toMatchObject({ id: uuid(71), status: 'CREATED', externalId: 'FC-1' });
      expect(h.orders.shipped).toEqual([ORDER]);
    });

    it('o livrare PENDING abia revendicata (sub prag) nu se reia, ca sa nu se dubleze o expediere in curs', async () => {
      await h.shipments.insert(
        Shipment.start({
          id: uuid(72),
          orderId: ORDER,
          courier: 'FAST_COURIER',
          cost: Money.of(3_200, 'RON'),
          now: START,
        }),
      );
      h.advance(STALE_PENDING_MS - 1);

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'SHIPMENT_IN_PROGRESS',
      });
      expect(h.services.FAST_COURIER.created).toHaveLength(0);
    });

    it('o expediere deja in curs (livrare PENDING) nu se dubleaza: SHIPMENT_IN_PROGRESS', async () => {
      await h.shipments.insert(
        Shipment.start({
          id: uuid(70),
          orderId: ORDER,
          courier: 'FAST_COURIER',
          cost: Money.of(3_200, 'RON'),
          now: START,
        }),
      );

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'SHIPMENT_IN_PROGRESS',
      });
      expect(h.services.FAST_COURIER.created).toHaveLength(0);
    });
  });

  describe('esecuri la curier', () => {
    it.each([
      [
        'refuz (adresa nelivrabila) -> 422',
        new CourierRejectedError('refuzat', 'address_not_serviceable'),
        'SHIPMENT_REJECTED',
        'address_not_serviceable',
      ],
      [
        'eroare tehnica -> 502',
        new CourierProviderError('cazut'),
        'COURIER_ERROR',
        'courier_error',
      ],
      [
        'timeout -> 504',
        new CourierTimeoutError('fara raspuns'),
        'COURIER_TIMEOUT',
        'courier_timeout',
      ],
    ])(
      '%s: livrarea se salveaza FAILED cu un cod stabil, comanda ramane PAID',
      async (_name, error, code, reason) => {
        h.services.FAST_COURIER.createError = error;

        await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({ code });

        const shipment = await h.shipments.findByOrderId(ORDER);
        expect(shipment).toMatchObject({
          status: 'FAILED',
          failureReason: reason,
          externalId: null,
        });
        expect(h.orders.shipped).toEqual([]);
        expect(h.orders.orders.get(ORDER)?.state).toBe('AWAITING_SHIPMENT');
      },
    );

    it('o expediere esuata se poate relua: aceeasi livrare, curierul e apelat din nou, comanda devine SHIPPED', async () => {
      h.services.FAST_COURIER.createError = new CourierTimeoutError('fara raspuns');
      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toBeInstanceOf(CourierTimeoutError);
      const failedId = (await h.shipments.findByOrderId(ORDER))?.id;

      h.services.FAST_COURIER.createError = null;
      const shipment = await h.shipOrder.execute(admin, ORDER);

      expect(shipment).toMatchObject({ id: failedId, status: 'CREATED', failureReason: null });
      expect(h.orders.shipped).toEqual([ORDER]);
    });

    it('doua reluari simultane ale unei expedieri esuate: doar una ajunge la curier', async () => {
      h.services.FAST_COURIER.createError = new CourierProviderError('cazut');
      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toBeDefined();
      h.services.FAST_COURIER.createError = null;

      const results = await Promise.allSettled([
        h.shipOrder.execute(admin, ORDER),
        h.shipOrder.execute(admin, ORDER),
        h.shipOrder.execute(admin, ORDER),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(h.services.FAST_COURIER.created).toHaveLength(1);
    });
  });

  describe('decontarea comenzii (SHIPPED) esueaza dupa ce curierul a preluat coletul', () => {
    it('livrarea ramane CREATED, iar reluarea duce la capat doar trecerea in SHIPPED, fara un al doilea colet', async () => {
      h.orders.markShippedError = new DomainError('baza cazuta', 'ORDER_CHANGED');
      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'ORDER_CHANGED',
      });
      expect((await h.shipments.findByOrderId(ORDER))?.status).toBe('CREATED');
      expect(h.orders.orders.get(ORDER)?.state).toBe('AWAITING_SHIPMENT');

      h.orders.markShippedError = null;
      const shipment = await h.shipOrder.execute(admin, ORDER);

      expect(shipment).toMatchObject({ status: 'CREATED', externalId: 'FC-1' });
      expect(h.services.FAST_COURIER.created).toHaveLength(1);
      expect(h.orders.shipped).toEqual([ORDER]);
    });

    it('cerere pierzatoare intr-o cursa: comanda a devenit SHIPPED intre citire si decontare => 409 ORDER_ALREADY_SHIPPED, nu 422', async () => {
      await h.shipOrder.execute(admin, ORDER);
      // o a doua cerere a citit comanda inainte de prima decontare: vede AWAITING_SHIPMENT, dar la decontare e deja SHIPPED
      const realFind = h.orders.find.bind(h.orders);
      let reads = 0;
      h.orders.find = async (id) => {
        const order = await realFind(id);
        return order && reads++ === 0 ? { ...order, state: 'AWAITING_SHIPMENT' } : order;
      };

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'ORDER_ALREADY_SHIPPED',
      });
      expect(h.services.FAST_COURIER.created).toHaveLength(1);
    });

    it('comanda anulata intre timp: eroarea tranzitiei ajunge la apelant, iar livrarea ramane CREATED (nu exista anulare de colet in port: limitare documentata)', async () => {
      h.orders.markShippedError = new DomainError(
        'Tranzitie invalida a comenzii: CANCELLED -> SHIPPED',
        'INVALID_ORDER_TRANSITION',
      );

      await expect(h.shipOrder.execute(admin, ORDER)).rejects.toMatchObject({
        code: 'INVALID_ORDER_TRANSITION',
      });
      expect(await h.shipments.findByOrderId(ORDER)).toMatchObject({ status: 'CREATED' });
    });
  });
});
