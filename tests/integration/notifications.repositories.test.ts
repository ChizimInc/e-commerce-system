import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { InMemoryUserRepository } from '../../src/modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from '../../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { Email } from '../../src/modules/identity/domain/Email';
import { User } from '../../src/modules/identity/domain/User';
import type { UserRepository } from '../../src/modules/identity/ports/out/UserRepository';
import { InMemoryNotificationOutbox } from '../../src/modules/notifications/adapters/persistence/InMemoryNotificationOutbox';
import { InMemoryNotificationPreferenceRepository } from '../../src/modules/notifications/adapters/persistence/InMemoryNotificationPreferenceRepository';
import { PrismaNotificationOutbox } from '../../src/modules/notifications/adapters/persistence/PrismaNotificationOutbox';
import { PrismaNotificationPreferenceRepository } from '../../src/modules/notifications/adapters/persistence/PrismaNotificationPreferenceRepository';
import type { NotificationRecord } from '../../src/modules/notifications/domain/NotificationRecord';
import type { NotificationOutbox } from '../../src/modules/notifications/ports/out/NotificationOutbox';
import type { NotificationPreferenceRepository } from '../../src/modules/notifications/ports/out/NotificationPreferenceRepository';
import { ConflictError } from '../../src/shared';

interface Harness {
  users: UserRepository;
  outbox: NotificationOutbox;
  preferences: NotificationPreferenceRepository;
  /** Sterge datele create de test (utilizatorii; notificarile si preferintele se sterg in cascada). */
  cleanup: (userIds: string[]) => Promise<void>;
  /** Doar PostgreSQL: interogari brute pentru verificarea constrangerilor din baza. */
  raw?: {
    insertLogRow: (row: Record<string, unknown>) => Promise<void>;
    countLogs: (userId: string) => Promise<number>;
    deleteUser: (userId: string) => Promise<void>;
  };
}

const T0 = new Date('2026-06-01T10:00:00.123Z');

/** Contractul `NotificationOutbox` si `NotificationPreferenceRepository`, rulat pe fiecare adaptor. */
function contract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository notificari: ${name}`, () => {
    const { users, outbox, preferences, cleanup, raw } = create();
    const tag = randomUUID().slice(0, 8);
    const userIds: string[] = [];

    afterAll(() => cleanup(userIds));

    const newUser = async (): Promise<string> => {
      const user = new User({
        id: randomUUID(),
        email: Email.of(`notif.${randomUUID().slice(0, 8)}.${tag}@test.local`),
        passwordHash: '$2b$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        role: 'CUSTOMER',
        createdAt: new Date(),
      });
      await users.save(user);
      userIds.push(user.id);
      return user.id;
    };

    const record = (
      recipientId: string,
      overrides: Partial<NotificationRecord> = {},
    ): NotificationRecord => ({
      id: randomUUID(),
      recipientId,
      channel: 'EMAIL',
      kind: 'ORDER_STATUS',
      orderId: randomUUID(),
      subject: 'Plata a fost confirmata',
      body: 'Buna ziua,\n\nAm incasat 514.08 RON.\n\nEchipa magazinului',
      createdAt: T0,
      ...overrides,
    });

    describe('NotificationOutbox', () => {
      it('salveaza o notificare si o regaseste identica (corp pe mai multe randuri, data cu milisecunde)', async () => {
        const userId = await newUser();
        const saved = record(userId);
        await outbox.append(saved);

        const { items, total } = await outbox.listByRecipient({
          recipientId: userId,
          limit: 10,
          offset: 0,
        });

        expect(total).toBe(1);
        expect(items).toEqual([saved]);
        expect(items[0]?.createdAt.toISOString()).toBe('2026-06-01T10:00:00.123Z');
      });

      it('pastreaza null la SMS (fara subiect) si la promotii (fara comanda)', async () => {
        const userId = await newUser();
        const sms = record(userId, {
          channel: 'SMS',
          subject: null,
          body: 'Comanda a fost plasata.',
        });
        const promo = record(userId, { kind: 'PROMO', orderId: null, channel: 'PUSH' });
        await outbox.append(sms);
        await outbox.append(promo);

        const { items } = await outbox.listByRecipient({
          recipientId: userId,
          limit: 10,
          offset: 0,
        });

        expect(items).toContainEqual(sms);
        expect(items).toContainEqual(promo);
      });

      it('cele mai noi primele, chiar la acelasi moment (ordinea inserarii departajeaza)', async () => {
        const userId = await newUser();
        const first = record(userId, { subject: 'unu' });
        const second = record(userId, { subject: 'doi' });
        const third = record(userId, { subject: 'trei' });
        for (const r of [first, second, third]) await outbox.append(r);

        const { items } = await outbox.listByRecipient({
          recipientId: userId,
          limit: 10,
          offset: 0,
        });

        expect(items.map((r) => r.subject)).toEqual(['trei', 'doi', 'unu']);
      });

      it('ordinea e cea a inserarii, nu a ceasului: o notificare cu data mai veche inserata ulterior ramane cea mai noua', async () => {
        const userId = await newUser();
        await outbox.append(
          record(userId, { subject: 'prima', createdAt: new Date('2026-06-01T12:00:00Z') }),
        );
        await outbox.append(
          record(userId, { subject: 'a doua', createdAt: new Date('2026-06-01T11:00:00Z') }),
        );

        const { items } = await outbox.listByRecipient({
          recipientId: userId,
          limit: 10,
          offset: 0,
        });

        expect(items.map((r) => r.subject)).toEqual(['a doua', 'prima']);
      });

      it('pagineaza stabil si intoarce totalul', async () => {
        const userId = await newUser();
        for (let i = 1; i <= 5; i++) await outbox.append(record(userId, { subject: `n${i}` }));

        const page1 = await outbox.listByRecipient({ recipientId: userId, limit: 2, offset: 0 });
        const page2 = await outbox.listByRecipient({ recipientId: userId, limit: 2, offset: 2 });
        const page3 = await outbox.listByRecipient({ recipientId: userId, limit: 2, offset: 4 });

        expect([page1.total, page2.total, page3.total]).toEqual([5, 5, 5]);
        expect(page1.items.map((r) => r.subject)).toEqual(['n5', 'n4']);
        expect(page2.items.map((r) => r.subject)).toEqual(['n3', 'n2']);
        expect(page3.items.map((r) => r.subject)).toEqual(['n1']);
      });

      it('fiecare destinatar vede doar notificarile lui', async () => {
        const ana = await newUser();
        const bob = await newUser();
        await outbox.append(record(ana, { subject: 'ana' }));
        await outbox.append(record(bob, { subject: 'bob' }));

        const forAna = await outbox.listByRecipient({ recipientId: ana, limit: 10, offset: 0 });

        expect(forAna.items.map((r) => r.subject)).toEqual(['ana']);
        expect(forAna.total).toBe(1);
        expect(
          (await outbox.listByRecipient({ recipientId: randomUUID(), limit: 10, offset: 0 })).total,
        ).toBe(0);
      });

      it('acelasi id de doua ori e refuzat cu ConflictError (nu duplicat, nu 500)', async () => {
        const userId = await newUser();
        const saved = record(userId);
        await outbox.append(saved);

        await expect(outbox.append(saved)).rejects.toBeInstanceOf(ConflictError);
      });
    });

    describe('NotificationPreferenceRepository', () => {
      it('un utilizator fara preferinte intoarce null (nu lista goala)', async () => {
        expect(await preferences.find(await newUser())).toBeNull();
      });

      it('salveaza si regaseste canalele, in ordinea standard', async () => {
        const userId = await newUser();
        await preferences.save(userId, ['PUSH', 'EMAIL']);

        expect(await preferences.find(userId)).toEqual(['EMAIL', 'PUSH']);
      });

      it('lista goala se pastreaza ca lista goala (nicio notificare), distincta de "fara preferinte"', async () => {
        const userId = await newUser();
        await preferences.save(userId, []);

        expect(await preferences.find(userId)).toEqual([]);
      });

      it('o noua salvare inlocuieste canalele (upsert), fara sa afecteze alti utilizatori', async () => {
        const ana = await newUser();
        const bob = await newUser();
        await preferences.save(ana, ['EMAIL', 'SMS']);
        await preferences.save(bob, ['PUSH']);

        await preferences.save(ana, ['SMS']);

        expect(await preferences.find(ana)).toEqual(['SMS']);
        expect(await preferences.find(bob)).toEqual(['PUSH']);
      });

      it('salvari simultane ale aceluiasi utilizator nu esueaza (ultima scriere castiga)', async () => {
        const userId = await newUser();

        const results = await Promise.allSettled(
          Array.from({ length: 8 }, (_, i) =>
            preferences.save(userId, i % 2 === 0 ? ['EMAIL'] : ['SMS', 'PUSH']),
          ),
        );

        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect([['EMAIL'], ['SMS', 'PUSH']]).toContainEqual(await preferences.find(userId));
      });
    });

    describe.skipIf(!raw)('constrangeri din baza de date (doar PostgreSQL)', () => {
      const row = async (overrides: Record<string, unknown>) => ({
        id: randomUUID(),
        user_id: await newUser(),
        channel: 'EMAIL',
        kind: 'ORDER_STATUS',
        order_id: null,
        subject: null,
        body: 'text',
        ...overrides,
      });

      it('refuza un corp gol', async () => {
        await expect(raw?.insertLogRow(await row({ body: '' }))).rejects.toThrow();
        await expect(raw?.insertLogRow(await row({}))).resolves.toBeUndefined();
      });

      it('notificarea si preferintele unui destinatar inexistent sunt refuzate de cheia straina (ConflictError, nu 500)', async () => {
        const ghost = randomUUID();
        await expect(outbox.append(record(ghost))).rejects.toBeInstanceOf(ConflictError);
        await expect(preferences.save(ghost, ['EMAIL'])).rejects.toBeInstanceOf(ConflictError);
      });

      it('stergerea utilizatorului sterge in cascada notificarile si preferintele lui', async () => {
        const userId = await newUser();
        await outbox.append(record(userId));
        await preferences.save(userId, ['SMS']);

        await raw?.deleteUser(userId);

        expect(await raw?.countLogs(userId)).toBe(0);
        expect(await preferences.find(userId)).toBeNull();
      });
    });
  });
}

contract('in-memory', () => ({
  users: new InMemoryUserRepository(),
  outbox: new InMemoryNotificationOutbox(),
  preferences: new InMemoryNotificationPreferenceRepository(),
  cleanup: () => Promise.resolve(),
}));

const databaseUrl = process.env['DATABASE_URL'];

contract(
  'Prisma/PostgreSQL',
  () => {
    const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
    return {
      users: new PrismaUserRepository(prisma),
      outbox: new PrismaNotificationOutbox(prisma),
      preferences: new PrismaNotificationPreferenceRepository(prisma),
      cleanup: async (userIds) => {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
      },
      raw: {
        insertLogRow: async (row) => {
          await prisma.$executeRaw`
            INSERT INTO notifications_log (id, user_id, channel, kind, order_id, subject, body)
            VALUES (${row['id']}::uuid, ${row['user_id']}::uuid, ${row['channel']}::"NotificationChannelType",
                    ${row['kind']}::"NotificationKind", ${row['order_id']}::uuid, ${row['subject']}, ${row['body']})`;
        },
        countLogs: (userId) => prisma.notificationLog.count({ where: { recipientId: userId } }),
        deleteUser: async (userId) => {
          await prisma.user.delete({ where: { id: userId } });
        },
      },
    };
  },
  Boolean(databaseUrl),
);
