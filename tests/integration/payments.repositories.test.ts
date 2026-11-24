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
import { InMemoryPaymentRepository } from '../../src/modules/payments/adapters/persistence/InMemoryPaymentRepository';
import { PrismaPaymentRepository } from '../../src/modules/payments/adapters/persistence/PrismaPaymentRepository';
import { Payment } from '../../src/modules/payments/domain/Payment';
import type { PaymentProvider } from '../../src/modules/payments/domain/PaymentTypes';
import type { PaymentRepository } from '../../src/modules/payments/ports/out/PaymentRepository';
import { ConflictError, Money, NotFoundError } from '../../src/shared';
import { makeAddress } from '../helpers/order-fixtures';

interface Harness {
  users: UserRepository;
  orders: OrderRepository;
  payments: PaymentRepository;
  /** Sterge datele create de test (plati, comenzi, utilizatori). */
  cleanup: (userIds: string[]) => Promise<void>;
  /** Doar PostgreSQL: interogari brute pentru verificarea constrangerilor din baza. */
  raw?: { insertPaymentRow: (row: Record<string, unknown>) => Promise<void> };
}

const T0 = new Date('2026-06-01T10:00:00.123Z');
const T1 = new Date('2026-06-01T10:00:07.456Z');

/** Contractul `PaymentRepository`, rulat pe fiecare adaptor (in-memory si PostgreSQL). */
function contract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository plati: ${name}`, () => {
    const { users, orders, payments, cleanup, raw } = create();
    const tag = randomUUID().slice(0, 8);
    const userIds: string[] = [];

    afterAll(() => cleanup(userIds));

    /** O comanda reala (in PostgreSQL plata are cheie straina catre `orders`). */
    const newOrder = async (): Promise<{ id: string; total: Money }> => {
      const user = new User({
        id: randomUUID(),
        email: Email.of(`plata.${randomUUID().slice(0, 8)}.${tag}@test.local`),
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
        .delivery('STANDARD')
        .payment('CARD')
        .pricing(NO_PRICE_MODIFIERS)
        .placedAt(T0)
        .build();
      await orders.add(order);
      return { id: order.id, total: order.total };
    };

    const newPayment = async (provider: PaymentProvider = 'STRIPE') => {
      const order = await newOrder();
      return Payment.start({
        id: randomUUID(),
        orderId: order.id,
        provider,
        amount: order.total,
        now: T0,
      });
    };

    describe('insert / findByOrderId', () => {
      it('salveaza o plata si o regaseste identica (suma in cenți + moneda, cheia de idempotenta, date cu milisecunde)', async () => {
        const payment = await newPayment();
        await payments.insert(payment);

        const loaded = await payments.findByOrderId(payment.orderId);

        expect(loaded).toEqual(payment);
        expect(loaded?.amount.toJSON()).toEqual({ amount: 12_345, currency: 'RON' });
        expect(loaded?.idempotencyKey).toBe(`pay:${payment.orderId}`);
        expect(loaded?.createdAt.toISOString()).toBe('2026-06-01T10:00:00.123Z');
      });

      it('o comanda fara plata intoarce null', async () => {
        expect(await payments.findByOrderId(randomUUID())).toBeNull();
      });

      it('a doua plata a aceleiasi comenzi e refuzata cu PAYMENT_EXISTS (cheie de idempotenta unica pe comanda)', async () => {
        const payment = await newPayment();
        await payments.insert(payment);
        const second = Payment.start({
          id: randomUUID(),
          orderId: payment.orderId,
          provider: 'STRIPE',
          amount: payment.amount,
          now: T1,
        });

        await expect(payments.insert(second)).rejects.toMatchObject({ code: 'PAYMENT_EXISTS' });
        expect((await payments.findByOrderId(payment.orderId))?.id).toBe(payment.id);
      });

      it('aceeasi cheie de idempotenta pe alta comanda e refuzata (unicitatea e pe cheie, nu doar pe comanda)', async () => {
        const first = await newPayment();
        await payments.insert(first);
        const other = await newPayment();
        const clash = Payment.restore({ ...other, idempotencyKey: first.idempotencyKey });

        await expect(payments.insert(clash)).rejects.toBeInstanceOf(ConflictError);
      });

      it('cereri concurente pe aceeasi comanda: exact o inserare reuseste, restul PAYMENT_EXISTS', async () => {
        const order = await newOrder();
        const attempts = Array.from({ length: 10 }, () =>
          payments.insert(
            Payment.start({
              id: randomUUID(),
              orderId: order.id,
              provider: 'STRIPE',
              amount: order.total,
              now: T0,
            }),
          ),
        );

        const results = await Promise.allSettled(attempts);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const result of results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )) {
          expect(result.reason).toMatchObject({ code: 'PAYMENT_EXISTS' });
        }
      });
    });

    describe('update (concurenta optimista pe status)', () => {
      it('persista tot ciclul: autorizare, captare, rambursare, cu id-urile externe', async () => {
        const pending = await newPayment('PAYPAL');
        await payments.insert(pending);
        const authorized = pending.authorized('PP-AUTH-1', T1);
        await payments.update(authorized, 'PENDING');
        const captured = authorized.captured('PP-CAP-1', T1);
        await payments.update(captured, 'AUTHORIZED');
        const refunding = captured.startRefund(T1);
        await payments.update(refunding, 'CAPTURED');
        const refunded = refunding.refunded('PP-REF-1', T1);
        await payments.update(refunded, 'REFUNDING');

        const loaded = await payments.findByOrderId(pending.orderId);

        expect(loaded).toEqual(refunded);
        expect(loaded).toMatchObject({
          status: 'REFUNDED',
          externalId: 'PP-CAP-1',
          refundExternalId: 'PP-REF-1',
        });
      });

      it('persista refuzul si motivul, iar reluarea il sterge', async () => {
        const pending = await newPayment();
        await payments.insert(pending);
        const declined = pending.declined('card_declined', T1);
        await payments.update(declined, 'PENDING');
        expect(await payments.findByOrderId(pending.orderId)).toMatchObject({
          status: 'DECLINED',
          failureReason: 'card_declined',
        });

        await payments.update(declined.retry(T1), 'DECLINED');

        expect(await payments.findByOrderId(pending.orderId)).toMatchObject({
          status: 'PENDING',
          failureReason: null,
        });
      });

      it('refuza cand statusul din baza nu mai e cel asteptat: PAYMENT_CHANGED, fara sa scrie nimic', async () => {
        const pending = await newPayment();
        await payments.insert(pending);

        await expect(payments.update(pending.declined('x', T1), 'CAPTURED')).rejects.toMatchObject({
          code: 'PAYMENT_CHANGED',
        });

        expect((await payments.findByOrderId(pending.orderId))?.status).toBe('PENDING');
      });

      it('o plata inexistenta este NotFoundError', async () => {
        const ghost = await newPayment();
        await expect(payments.update(ghost.failed('x', T1), 'PENDING')).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it('doua procese care revendica aceeasi tranzitie: doar unul reuseste', async () => {
        const pending = await newPayment();
        await payments.insert(pending);
        const captured = pending.authorized('ext-1', T1).captured('ext-1', T1);
        await payments.update(pending.authorized('ext-1', T1), 'PENDING');
        await payments.update(captured, 'AUTHORIZED');

        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => payments.update(captured.startRefund(T1), 'CAPTURED')),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const result of results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )) {
          expect(result.reason).toMatchObject({ code: 'PAYMENT_CHANGED' });
        }
      });
    });

    describe('findByExternalId', () => {
      it('gaseste plata dupa furnizor + id-ul tranzactiei (cel curent)', async () => {
        const pending = await newPayment('STRIPE');
        await payments.insert(pending);
        const authorized = pending.authorized(`pi_${tag}_a`, T1);
        await payments.update(authorized, 'PENDING');

        expect((await payments.findByExternalId('STRIPE', `pi_${tag}_a`))?.id).toBe(pending.id);
        expect(await payments.findByExternalId('PAYPAL', `pi_${tag}_a`)).toBeNull();
        expect(await payments.findByExternalId('STRIPE', `pi_${tag}_inexistent`)).toBeNull();
      });

      it('perechea (furnizor, id extern) e unica: alta plata nu poate prelua acelasi id; alt furnizor poate', async () => {
        const first = await newPayment('STRIPE');
        await payments.insert(first);
        await payments.update(first.authorized(`shared_${tag}`, T1), 'PENDING');

        const second = await newPayment('STRIPE');
        await payments.insert(second);
        await expect(
          payments.update(second.authorized(`shared_${tag}`, T1), 'PENDING'),
        ).rejects.toBeInstanceOf(ConflictError);

        const other = await newPayment('PAYPAL');
        await payments.insert(other);
        await expect(
          payments.update(other.authorized(`shared_${tag}`, T1), 'PENDING'),
        ).resolves.toBeUndefined();
      });
    });

    describe.skipIf(!raw)('constrangeri din baza de date (doar PostgreSQL)', () => {
      const row = async (overrides: Record<string, unknown>) => {
        const order = await newOrder();
        return {
          id: randomUUID(),
          order_id: order.id,
          provider: 'STRIPE',
          status: 'PENDING',
          amount: 100,
          currency: 'RON',
          external_id: null,
          refund_external_id: null,
          idempotency_key: `pay:${order.id}`,
          ...overrides,
        };
      };

      it('refuza o suma zero sau negativa', async () => {
        await expect(raw?.insertPaymentRow(await row({ amount: 0 }))).rejects.toThrow();
        await expect(raw?.insertPaymentRow(await row({ amount: -5 }))).rejects.toThrow();
      });

      it('refuza o plata incasata fara id extern, si una rambursata fara id-ul rambursarii', async () => {
        await expect(raw?.insertPaymentRow(await row({ status: 'CAPTURED' }))).rejects.toThrow();
        await expect(
          raw?.insertPaymentRow(await row({ status: 'REFUNDED', external_id: 'x' })),
        ).rejects.toThrow();
        await expect(
          raw?.insertPaymentRow(await row({ status: 'CAPTURED', external_id: `ok_${tag}` })),
        ).resolves.toBeUndefined();
      });

      it('plata unei comenzi inexistente e refuzata de cheia straina (ConflictError, nu 500)', async () => {
        const orphan = Payment.start({
          id: randomUUID(),
          orderId: randomUUID(),
          provider: 'STRIPE',
          amount: Money.of(100, 'RON'),
          now: T0,
        });
        await expect(payments.insert(orphan)).rejects.toBeInstanceOf(ConflictError);
      });
    });
  });
}

contract('in-memory', () => ({
  users: new InMemoryUserRepository(),
  orders: new InMemoryOrderRepository(),
  payments: new InMemoryPaymentRepository(),
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
      payments: new PrismaPaymentRepository(prisma),
      cleanup: async (userIds) => {
        // Platile refera comenzile cu ON DELETE RESTRICT, iar comenzile utilizatorii: se sterg in aceasta ordine.
        await prisma.payment.deleteMany({ where: { order: { customerId: { in: userIds } } } });
        await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
      },
      raw: {
        insertPaymentRow: async (row) => {
          await prisma.$executeRaw`
            INSERT INTO payments (id, order_id, provider, status, amount, currency, external_id, refund_external_id, idempotency_key, updated_at)
            VALUES (${row['id']}::uuid, ${row['order_id']}::uuid, ${row['provider']}::"PaymentProvider", ${row['status']}::"PaymentStatus",
                    ${row['amount']}::int, ${row['currency']}::"Currency", ${row['external_id']}, ${row['refund_external_id']},
                    ${row['idempotency_key']}, now())`;
        },
      },
    };
  },
  Boolean(databaseUrl),
);
