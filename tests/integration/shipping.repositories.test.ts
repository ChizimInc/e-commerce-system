import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { InMemoryUserRepository } from '../../src/modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from '../../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { Email } from '../../src/modules/identity/domain/Email';
import { User } from '../../src/modules/identity/domain/User';
import type { UserRepository } from '../../src/modules/identity/ports/out/UserRepository';
import { InMemoryOrderRepository } from '../../src/modules/ordering/adapters/persistence/InMemoryOrderRepository';
import { PrismaOrderRepository } from '../../src/modules/ordering/adapters/persistence/PrismaOrderRepository';
import { OrderBuilder } from '../../src/modules/ordering/domain/OrderBuilder';
import { NO_PRICE_MODIFIERS } from '../../src/modules/ordering/domain/pricing/PricingPolicy';
import type { OrderRepository } from '../../src/modules/ordering/ports/out/OrderRepository';
import { InMemoryShipmentRepository } from '../../src/modules/shipping/adapters/persistence/InMemoryShipmentRepository';
import { PrismaShipmentRepository } from '../../src/modules/shipping/adapters/persistence/PrismaShipmentRepository';
import { Shipment } from '../../src/modules/shipping/domain/Shipment';
import type { CourierCode } from '../../src/modules/shipping/domain/ShippingTypes';
import type { ShipmentRepository } from '../../src/modules/shipping/ports/out/ShipmentRepository';
import { ConflictError, Money, NotFoundError } from '../../src/shared';
import { makeAddress } from '../helpers/order-fixtures';

interface Harness {
  users: UserRepository;
  orders: OrderRepository;
  shipments: ShipmentRepository;
  /** Sterge datele create de test (livrari, comenzi, utilizatori). */
  cleanup: (userIds: string[]) => Promise<void>;
  /** Doar PostgreSQL: interogari brute pentru verificarea constrangerilor din baza. */
  raw?: { insertShipmentRow: (row: Record<string, unknown>) => Promise<void> };
}

const T0 = new Date('2026-06-01T10:00:00.123Z');
const T1 = new Date('2026-06-01T10:00:07.456Z');

/** Contractul `ShipmentRepository`, rulat pe fiecare adaptor (in-memory si PostgreSQL). */
function contract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository livrari: ${name}`, () => {
    const { users, orders, shipments, cleanup, raw } = create();
    const tag = randomUUID().slice(0, 8);
    const userIds: string[] = [];

    afterAll(() => cleanup(userIds));

    /** O comanda reala (in PostgreSQL livrarea are cheie straina catre `orders`). */
    const newOrder = async (): Promise<{ id: string }> => {
      const user = new User({
        id: randomUUID(),
        email: Email.of(`livrare.${randomUUID().slice(0, 8)}.${tag}@test.local`),
        passwordHash: '$2b$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        role: 'CUSTOMER',
        createdAt: new Date(),
      });
      await users.save(user);
      userIds.push(user.id);
      const order = OrderBuilder.forOrder(randomUUID())
        .customer(user.id)
        .addItems([
          {
            itemId: randomUUID(),
            name: 'Articol',
            unitPrice: Money.of(12_345, 'RON'),
            quantity: 1,
          },
        ])
        .shippingAddress(makeAddress())
        .delivery('EXPRESS')
        .payment('CARD')
        .pricing(NO_PRICE_MODIFIERS)
        .placedAt(T0)
        .build();
      await orders.add(order);
      return { id: order.id };
    };

    const newShipment = async (courier: CourierCode = 'FAST_COURIER') => {
      const order = await newOrder();
      return Shipment.start({
        id: randomUUID(),
        orderId: order.id,
        courier,
        cost: Money.of(3_200, 'RON'),
        now: T0,
      });
    };

    describe('insert / findByOrderId', () => {
      it('salveaza o livrare si o regaseste identica (cost in cenți + moneda, date cu milisecunde)', async () => {
        const shipment = await newShipment();
        await shipments.insert(shipment);

        const loaded = await shipments.findByOrderId(shipment.orderId);

        expect(loaded).toEqual(shipment);
        expect(loaded?.cost.toJSON()).toEqual({ amount: 3_200, currency: 'RON' });
        expect(loaded?.createdAt.toISOString()).toBe('2026-06-01T10:00:00.123Z');
      });

      it('o comanda fara livrare intoarce null', async () => {
        expect(await shipments.findByOrderId(randomUUID())).toBeNull();
      });

      it('a doua livrare a aceleiasi comenzii e refuzata cu SHIPMENT_EXISTS', async () => {
        const shipment = await newShipment();
        await shipments.insert(shipment);
        const second = Shipment.start({
          id: randomUUID(),
          orderId: shipment.orderId,
          courier: 'POST_OFFICE',
          cost: shipment.cost,
          now: T1,
        });

        await expect(shipments.insert(second)).rejects.toMatchObject({ code: 'SHIPMENT_EXISTS' });
        expect((await shipments.findByOrderId(shipment.orderId))?.id).toBe(shipment.id);
      });

      it('cereri concurente pe aceeasi comanda: exact o inserare reuseste, restul SHIPMENT_EXISTS', async () => {
        const order = await newOrder();
        const attempts = Array.from({ length: 10 }, () =>
          shipments.insert(
            Shipment.start({
              id: randomUUID(),
              orderId: order.id,
              courier: 'FAST_COURIER',
              cost: Money.of(3_200, 'RON'),
              now: T0,
            }),
          ),
        );
        const results = await Promise.allSettled(attempts);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const result of results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )) {
          expect(result.reason).toMatchObject({ code: 'SHIPMENT_EXISTS' });
        }
      });
    });

    describe('update (concurenta optimista pe status)', () => {
      it('persista tot ciclul: preluare de curier, tranzit, livrare, cu id-ul si numarul de urmarire', async () => {
        const pending = await newShipment('POST_OFFICE');
        await shipments.insert(pending);
        const created = pending.created(`PO-${tag}-1`, `RR${tag}1RO`, T1);
        await shipments.update(created, 'PENDING');
        const inTransit = created.tracked('IN_TRANSIT', T1);
        await shipments.update(inTransit, 'CREATED');
        const delivered = inTransit.tracked('DELIVERED', T1);
        await shipments.update(delivered, 'IN_TRANSIT');

        const loaded = await shipments.findByOrderId(pending.orderId);

        expect(loaded).toEqual(delivered);
        expect(loaded).toMatchObject({
          status: 'DELIVERED',
          externalId: `PO-${tag}-1`,
          trackingNumber: `RR${tag}1RO`,
        });
      });

      it('persista esecul si motivul, iar reluarea il sterge', async () => {
        const pending = await newShipment();
        await shipments.insert(pending);
        const failed = pending.failed('address_not_serviceable', T1);
        await shipments.update(failed, 'PENDING');
        expect(await shipments.findByOrderId(pending.orderId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'address_not_serviceable',
        });

        await shipments.update(failed.retry(T1), 'FAILED');

        expect(await shipments.findByOrderId(pending.orderId)).toMatchObject({
          status: 'PENDING',
          failureReason: null,
        });
      });

      it('refuza cand statusul din baza nu mai e cel asteptat: SHIPMENT_CHANGED, fara sa scrie nimic', async () => {
        const pending = await newShipment();
        await shipments.insert(pending);

        await expect(shipments.update(pending.failed('x', T1), 'CREATED')).rejects.toMatchObject({
          code: 'SHIPMENT_CHANGED',
        });

        expect((await shipments.findByOrderId(pending.orderId))?.status).toBe('PENDING');
      });

      it('o livrare inexistenta este NotFoundError', async () => {
        const ghost = await newShipment();
        await expect(shipments.update(ghost.failed('x', T1), 'PENDING')).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it('doua procese care revendica aceeasi reluare: doar unul reuseste', async () => {
        const pending = await newShipment();
        await shipments.insert(pending);
        const failed = pending.failed('courier_error', T1);
        await shipments.update(failed, 'PENDING');

        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => shipments.update(failed.retry(T1), 'FAILED')),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const result of results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )) {
          expect(result.reason).toMatchObject({ code: 'SHIPMENT_CHANGED' });
        }
      });
    });

    describe('unicitatea (curier, id extern)', () => {
      it('perechea (curier, id extern) e unica: alta livrare nu poate prelua acelasi id; alt curier poate', async () => {
        const first = await newShipment('FAST_COURIER');
        await shipments.insert(first);
        await shipments.update(first.created(`shared_${tag}`, 'T1', T1), 'PENDING');

        const second = await newShipment('FAST_COURIER');
        await shipments.insert(second);
        await expect(
          shipments.update(second.created(`shared_${tag}`, 'T2', T1), 'PENDING'),
        ).rejects.toBeInstanceOf(ConflictError);

        const other = await newShipment('POST_OFFICE');
        await shipments.insert(other);
        await expect(
          shipments.update(other.created(`shared_${tag}`, 'T3', T1), 'PENDING'),
        ).resolves.toBeUndefined();
      });
    });

    describe.skipIf(!raw)('constrangeri din baza de date (doar PostgreSQL)', () => {
      const row = async (overrides: Record<string, unknown>) => {
        const order = await newOrder();
        return {
          id: randomUUID(),
          order_id: order.id,
          courier: 'FAST_COURIER',
          status: 'PENDING',
          cost_amount: 100,
          currency: 'RON',
          external_id: null,
          tracking_number: null,
          ...overrides,
        };
      };

      it('refuza un cost negativ (zero e permis: ridicare din magazin)', async () => {
        await expect(raw?.insertShipmentRow(await row({ cost_amount: -1 }))).rejects.toThrow();
        await expect(
          raw?.insertShipmentRow(await row({ cost_amount: 0 })),
        ).resolves.toBeUndefined();
      });

      it('refuza un colet preluat de curier fara id extern sau fara numar de urmarire', async () => {
        await expect(raw?.insertShipmentRow(await row({ status: 'CREATED' }))).rejects.toThrow();
        await expect(
          raw?.insertShipmentRow(await row({ status: 'IN_TRANSIT', external_id: 'x' })),
        ).rejects.toThrow();
        await expect(
          raw?.insertShipmentRow(
            await row({ status: 'DELIVERED', external_id: `ok_${tag}`, tracking_number: 'T' }),
          ),
        ).resolves.toBeUndefined();
      });

      it('livrarea unei comenzi inexistente e refuzata de cheia straina (ConflictError, nu 500)', async () => {
        const orphan = Shipment.start({
          id: randomUUID(),
          orderId: randomUUID(),
          courier: 'FAST_COURIER',
          cost: Money.of(100, 'RON'),
          now: T0,
        });
        await expect(shipments.insert(orphan)).rejects.toBeInstanceOf(ConflictError);
      });
    });
  });
}

contract('in-memory', () => ({
  users: new InMemoryUserRepository(),
  orders: new InMemoryOrderRepository(),
  shipments: new InMemoryShipmentRepository(),
  cleanup: () => Promise.resolve(),
}));

const databaseUrl = process.env['DATABASE_URL'];

contract(
  'Prisma/PostgreSQL',
  () => {
    const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
    return {
      users: new PrismaUserRepository(prisma),
      orders: new PrismaOrderRepository(prisma),
      shipments: new PrismaShipmentRepository(prisma),
      cleanup: async (userIds) => {
        // Livrarile refera comenzile cu ON DELETE RESTRICT, iar comenzile utilizatorii: se sterg in aceasta ordine.
        await prisma.shipment.deleteMany({ where: { order: { customerId: { in: userIds } } } });
        await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
      },
      raw: {
        insertShipmentRow: async (row) => {
          await prisma.$executeRaw`
            INSERT INTO shipments (id, order_id, courier, status, cost_amount, currency, external_id, tracking_number, updated_at)
            VALUES (${row['id']}::uuid, ${row['order_id']}::uuid, ${row['courier']}::"ShipmentCourier", ${row['status']}::"ShipmentStatus",
                    ${row['cost_amount']}::int, ${row['currency']}::"Currency", ${row['external_id']}, ${row['tracking_number']}, now())`;
        },
      },
    };
  },
  Boolean(databaseUrl),
);
