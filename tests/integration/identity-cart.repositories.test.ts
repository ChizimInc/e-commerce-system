import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { InMemoryCartRepository } from '../../src/modules/cart/adapters/persistence/InMemoryCartRepository';
import { PrismaCartRepository } from '../../src/modules/cart/adapters/persistence/PrismaCartRepository';
import { Cart } from '../../src/modules/cart/domain/Cart';
import type { CartRepository } from '../../src/modules/cart/ports/out/CartRepository';
import { InMemoryUserRepository } from '../../src/modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from '../../src/modules/identity/adapters/persistence/PrismaUserRepository';
import { Email } from '../../src/modules/identity/domain/Email';
import { User } from '../../src/modules/identity/domain/User';
import type { UserRepository } from '../../src/modules/identity/ports/out/UserRepository';
import { ConflictError, type Role } from '../../src/shared';

interface Harness {
  users: UserRepository;
  carts: CartRepository;
  /** Sterge utilizatorii creati (cosurile lor dispar prin ON DELETE CASCADE). */
  cleanup: (userIds: string[]) => Promise<void>;
}

/** Contractul porturilor `UserRepository` si `CartRepository`, rulat pe fiecare adaptor. */
function contract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository-uri identity + cart: ${name}`, () => {
    const { users, carts, cleanup } = create();
    const tag = randomUUID().slice(0, 8);
    const createdUsers: string[] = [];

    const newUser = async (label: string, role: Role = 'CUSTOMER') => {
      const user = new User({
        id: randomUUID(),
        email: Email.of(`${label}.${tag}@test.local`),
        passwordHash: '$2b$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
        role,
        createdAt: new Date('2026-01-02T03:04:05.678Z'),
      });
      await users.save(user);
      createdUsers.push(user.id);
      return user;
    };

    afterAll(() => cleanup(createdUsers));

    describe('utilizatori', () => {
      it('salveaza si citeste un utilizator dupa id si dupa email (inclusiv rol si data)', async () => {
        const admin = await newUser('admin', 'ADMIN');
        for (const found of [
          await users.findById(admin.id),
          await users.findByEmail(admin.email),
        ]) {
          expect(found?.id).toBe(admin.id);
          expect(found?.email.value).toBe(admin.email.value);
          expect(found?.role).toBe('ADMIN');
          expect(found?.passwordHash).toBe(admin.passwordHash);
          expect(found?.createdAt.toISOString()).toBe('2026-01-02T03:04:05.678Z');
        }
      });

      it('intoarce null pentru utilizator inexistent', async () => {
        expect(await users.findById(randomUUID())).toBeNull();
        expect(await users.findByEmail(Email.of(`nimeni.${tag}@test.local`))).toBeNull();
      });

      it('refuza emailul duplicat cu ConflictError(EMAIL_TAKEN)', async () => {
        const first = await newUser('dup');
        const clone = new User({ ...first, id: randomUUID() });
        await expect(users.save(clone)).rejects.toBeInstanceOf(ConflictError);
        await expect(users.save(clone)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
      });

      it('emailul se cauta fara diferenta intre litere mari si mici (e normalizat)', async () => {
        const user = await newUser('case');
        expect((await users.findByEmail(Email.of(user.email.value.toUpperCase())))?.id).toBe(
          user.id,
        );
      });
    });

    describe('cosuri', () => {
      const itemA = randomUUID();
      const itemB = randomUUID();
      const itemC = randomUUID();

      it('nu exista cos inainte de prima salvare', async () => {
        const user = await newUser('nocart');
        expect(await carts.findByUserId(user.id)).toBeNull();
      });

      it('salveaza un cos si il regaseste cu articolele in ordinea adaugarii', async () => {
        const user = await newUser('cart1');
        const cart = Cart.empty(randomUUID(), user.id)
          .addItem(itemC, 1)
          .addItem(itemA, 4)
          .addItem(itemB, 2);
        await carts.save(cart);
        const loaded = await carts.findByUserId(user.id);
        expect(loaded?.id).toBe(cart.id);
        expect(loaded?.items).toEqual([
          { itemId: itemC, quantity: 1 },
          { itemId: itemA, quantity: 4 },
          { itemId: itemB, quantity: 2 },
        ]);
      });

      it('a doua salvare inlocuieste articolele (modificare, stergere, golire)', async () => {
        const user = await newUser('cart2');
        const initial = Cart.empty(randomUUID(), user.id).addItem(itemA, 1).addItem(itemB, 1);
        await carts.save(initial);

        await carts.save(initial.setQuantity(itemA, 7).removeItem(itemB));
        expect((await carts.findByUserId(user.id))?.items).toEqual([
          { itemId: itemA, quantity: 7 },
        ]);

        await carts.save(initial.clear());
        const emptied = await carts.findByUserId(user.id);
        expect(emptied?.items).toEqual([]);
        expect(emptied?.id).toBe(initial.id); // acelasi cos, nu unul nou
      });

      it('cosurile utilizatorilor sunt separate', async () => {
        const first = await newUser('cart3');
        const second = await newUser('cart4');
        await carts.save(Cart.empty(randomUUID(), first.id).addItem(itemA, 2));
        await carts.save(Cart.empty(randomUUID(), second.id).addItem(itemB, 3));
        expect((await carts.findByUserId(first.id))?.items).toEqual([
          { itemId: itemA, quantity: 2 },
        ]);
        expect((await carts.findByUserId(second.id))?.items).toEqual([
          { itemId: itemB, quantity: 3 },
        ]);
      });
    });
  });
}

contract('in-memory', () => ({
  users: new InMemoryUserRepository(),
  carts: new InMemoryCartRepository(),
  cleanup: () => Promise.resolve(),
}));

const databaseUrl = process.env['DATABASE_URL'];

contract(
  'Prisma/PostgreSQL',
  () => {
    const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
    return {
      users: new PrismaUserRepository(prisma),
      carts: new PrismaCartRepository(prisma),
      cleanup: async (userIds) => {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
      },
    };
  },
  Boolean(databaseUrl),
);
