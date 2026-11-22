import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';
import { CachingProductRepository } from '../../src/modules/catalog/adapters/persistence/CachingProductRepository';
import { InMemoryBundleRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryCategoryRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryCategoryRepository';
import { InMemoryProductRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryProductRepository';
import { PrismaBundleRepository } from '../../src/modules/catalog/adapters/persistence/PrismaBundleRepository';
import { PrismaCategoryRepository } from '../../src/modules/catalog/adapters/persistence/PrismaCategoryRepository';
import { PrismaProductRepository } from '../../src/modules/catalog/adapters/persistence/PrismaProductRepository';
import { Bundle } from '../../src/modules/catalog/domain/Bundle';
import { Category } from '../../src/modules/catalog/domain/Category';
import type { BundleRepository } from '../../src/modules/catalog/ports/out/BundleRepository';
import type { CategoryRepository } from '../../src/modules/catalog/ports/out/CategoryRepository';
import type { ProductRepository } from '../../src/modules/catalog/ports/out/ProductRepository';
import { makeProduct } from '../helpers/catalog-fixtures';

interface Harness {
  products: ProductRepository;
  categories: CategoryRepository;
  bundles: BundleRepository;
  /** Sterge datele create de test (relevant doar pentru baza de date reala). */
  cleanup: () => Promise<void>;
}

/**
 * Contractul porturilor de persistenta: aceleasi teste ruleaza pe fiecare adaptor
 * (in-memory, proxy cu cache, Prisma/PostgreSQL), deci adaptoarele sunt interschimbabile.
 */
function repositoryContract(name: string, create: () => Harness, enabled = true): void {
  describe.skipIf(!enabled)(`Contract repository-uri catalog: ${name}`, () => {
    const harness = create();
    const { products, categories, bundles } = harness;
    // Prefix unic pe rulare: testele nu depind de alte date existente in aceeasi baza.
    const tag = `t${randomUUID().slice(0, 8)}`;
    const created = {
      products: new Set<string>(),
      categories: new Set<string>(),
      bundles: new Set<string>(),
    };

    const newProduct = async (overrides: Parameters<typeof makeProduct>[0] = {}) => {
      const product = makeProduct({
        id: randomUUID(),
        ...overrides,
        name: `${tag} ${overrides.name ?? 'Produs'}`,
      });
      await products.save(product);
      created.products.add(product.id);
      return product;
    };
    const newCategory = async (name: string, parentId: string | null = null) => {
      const category = Category.create({ id: randomUUID(), name: `${tag} ${name}`, parentId });
      await categories.save(category);
      created.categories.add(category.id);
      return category;
    };
    const newBundle = async (
      components: { productId: string; quantity: number }[],
      discountPercent = 0,
    ) => {
      const found = await products.findByIds(components.map((c) => c.productId));
      const bundle = Bundle.create({
        id: randomUUID(),
        name: `${tag} Pachet`,
        description: 'desc',
        discountPercent,
        components: components.map((c) => ({
          item:
            found.find((p) => p.id === c.productId) ??
            (() => {
              throw new Error('lipsa');
            })(),
          quantity: c.quantity,
        })),
      });
      await bundles.save(bundle);
      created.bundles.add(bundle.id);
      return bundle;
    };
    const search = (query: string, extra: { categoryIds?: string[] } = {}) =>
      products.findMany({ query, limit: 50, offset: 0, ...extra });

    afterAll(async () => {
      for (const id of created.bundles) await bundles.delete(id);
      for (const id of created.products) await products.delete(id);
      // copiii inaintea parintilor (FK): ordinea inversa a crearii
      for (const id of [...created.categories].reverse()) await categories.delete(id);
      await harness.cleanup();
    });

    describe('produse', () => {
      it('salveaza si citeste un produs cu toate campurile', async () => {
        const category = await newCategory('Cat');
        const saved = await newProduct({
          name: 'Complet',
          description: 'O descriere',
          amount: 12_345,
          currency: 'EUR',
          stock: 7,
          categoryId: category.id,
        });
        const loaded = await products.findById(saved.id);
        expect(loaded).toEqual(saved);
        expect(loaded?.price.toJSON()).toEqual({ amount: 12_345, currency: 'EUR' });
      });

      it('intoarce null pentru un id inexistent', async () => {
        expect(await products.findById(randomUUID())).toBeNull();
      });

      it('save face upsert: a doua salvare actualizeaza produsul', async () => {
        const original = await newProduct({ name: 'Upsert', stock: 1 });
        await products.save(original.withChanges({ stock: 9, name: `${tag} Upsert 2` }));
        const loaded = await products.findById(original.id);
        expect(loaded).toMatchObject({ stock: 9, name: `${tag} Upsert 2` });
      });

      it('findByIds intoarce doar produsele existente', async () => {
        const a = await newProduct({ name: 'A' });
        const b = await newProduct({ name: 'B' });
        const found = await products.findByIds([a.id, randomUUID(), b.id, a.id]);
        expect(found.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
        expect(await products.findByIds([])).toEqual([]);
      });

      it('delete intoarce true o data, apoi false', async () => {
        const product = await newProduct({ name: 'De sters' });
        expect(await products.delete(product.id)).toBe(true);
        expect(await products.findById(product.id)).toBeNull();
        expect(await products.delete(product.id)).toBe(false);
      });
    });

    describe('cautare si filtrare', () => {
      it('cauta fara diferenta intre litere mari/mici, in nume si descriere', async () => {
        const byName = await newProduct({ name: 'Zebra Alfa' });
        const byDescription = await newProduct({
          name: 'Altceva',
          description: 'contine ZEBRA aici',
        });
        await newProduct({ name: 'Nimic' });
        const page = await search('zebra');
        const ids = page.items.map((p) => p.id);
        expect(ids).toContain(byName.id);
        expect(ids).toContain(byDescription.id);
        expect((await search(`${tag} Zebra`)).items.map((p) => p.id)).toEqual([byName.id]);
      });

      it('trateaza % si _ din text ca simboluri literale, nu ca wildcard-uri', async () => {
        const percent = await newProduct({ name: 'reducere 100% azi' });
        await newProduct({ name: 'reducere 100 de lei' });
        const underscore = await newProduct({ name: 'cod a_c' });
        await newProduct({ name: 'cod abc' });
        expect((await search(`${tag} reducere 100%`)).items.map((p) => p.id)).toEqual([percent.id]);
        expect((await search(`${tag} cod a_c`)).items.map((p) => p.id)).toEqual([underscore.id]);
      });

      it('filtreaza pe categorii; lista goala nu intoarce nimic; undefined nu filtreaza', async () => {
        const c1 = await newCategory('C1');
        const c2 = await newCategory('C2');
        const inC1 = await newProduct({ name: 'Filtru 1', categoryId: c1.id });
        const inC2 = await newProduct({ name: 'Filtru 2', categoryId: c2.id });
        await newProduct({ name: 'Filtru 3' });

        const both = await search(`${tag} Filtru`, { categoryIds: [c1.id, c2.id] });
        expect(both.items.map((p) => p.id).sort()).toEqual([inC1.id, inC2.id].sort());
        expect((await search(`${tag} Filtru`, { categoryIds: [] })).total).toBe(0);
        expect((await search(`${tag} Filtru`)).total).toBe(3);
      });

      it('sorteaza dupa nume si pagineaza stabil, cu total corect', async () => {
        for (const name of ['Pag C', 'Pag A', 'Pag B', 'Pag D']) await newProduct({ name });
        const first = await products.findMany({ query: `${tag} Pag`, limit: 3, offset: 0 });
        const second = await products.findMany({ query: `${tag} Pag`, limit: 3, offset: 3 });
        expect(first.total).toBe(4);
        expect(first.items.map((p) => p.name)).toEqual([
          `${tag} Pag A`,
          `${tag} Pag B`,
          `${tag} Pag C`,
        ]);
        expect(second.items.map((p) => p.name)).toEqual([`${tag} Pag D`]);
      });

      it('countByCategories numara produsele din categoriile date', async () => {
        const category = await newCategory('Numarat');
        await newProduct({ name: 'N1', categoryId: category.id });
        await newProduct({ name: 'N2', categoryId: category.id });
        expect(await products.countByCategories([category.id])).toBe(2);
        expect(await products.countByCategories([randomUUID()])).toBe(0);
      });
    });

    describe('categorii', () => {
      it('salveaza ierarhia, o citeste, o actualizeaza si o sterge', async () => {
        const parent = await newCategory('Parinte');
        const child = await newCategory('Copil', parent.id);
        expect(await categories.findById(child.id)).toEqual(child);
        expect((await categories.findAll()).map((c) => c.id)).toEqual(
          expect.arrayContaining([parent.id, child.id]),
        );

        await categories.save(child.withChanges({ name: `${tag} Mutat`, parentId: null }));
        expect(await categories.findById(child.id)).toMatchObject({
          name: `${tag} Mutat`,
          parentId: null,
        });

        expect(await categories.delete(child.id)).toBe(true);
        expect(await categories.delete(child.id)).toBe(false);
        expect(await categories.findById(randomUUID())).toBeNull();
      });
    });

    describe('pachete', () => {
      it('salveaza un pachet si il reconstruieste cu pret calculat si componente', async () => {
        const mouse = await newProduct({ name: 'Mouse', amount: 5000, stock: 10 });
        const pad = await newProduct({ name: 'Covoras', amount: 2000, stock: 3 });
        const bundle = await newBundle(
          [
            { productId: mouse.id, quantity: 1 },
            { productId: pad.id, quantity: 2 },
          ],
          10,
        );
        const loaded = await bundles.findById(bundle.id);
        expect(loaded?.getPrice().amount).toBe(8100);
        expect(loaded?.availableStock()).toBe(1); // covoras: floor(3 / 2)
        expect(loaded?.components.map((c) => [c.item.id, c.quantity]).sort()).toEqual(
          [
            [mouse.id, 1],
            [pad.id, 2],
          ].sort(),
        );
        expect((await bundles.findAll()).map((b) => b.id)).toContain(bundle.id);
      });

      it('actualizarea inlocuieste componentele', async () => {
        const a = await newProduct({ name: 'PA', amount: 1000 });
        const b = await newProduct({ name: 'PB', amount: 3000 });
        const bundle = await newBundle([{ productId: a.id, quantity: 1 }]);
        await bundles.save(bundle.withChanges({ components: [{ item: b, quantity: 2 }] }));
        const loaded = await bundles.findById(bundle.id);
        expect(loaded?.components.map((c) => c.item.id)).toEqual([b.id]);
        expect(loaded?.getPrice().amount).toBe(6000);
        expect(await bundles.existsWithProduct(a.id)).toBe(false);
        expect(await bundles.existsWithProduct(b.id)).toBe(true);
      });

      it('pretul pachetului urmareste modificarile produsului (date proaspete)', async () => {
        const product = await newProduct({ name: 'Volatil', amount: 1000, stock: 4 });
        const bundle = await newBundle([{ productId: product.id, quantity: 2 }]);
        await products.save(product.withChanges({ stock: 2 }));
        const loaded = await bundles.findById(bundle.id);
        expect(loaded?.availableStock()).toBe(1);
      });

      it('delete intoarce true o data, apoi false; id inexistent da null', async () => {
        const product = await newProduct({ name: 'PX' });
        const bundle = await newBundle([{ productId: product.id, quantity: 1 }]);
        expect(await bundles.delete(bundle.id)).toBe(true);
        expect(await bundles.delete(bundle.id)).toBe(false);
        expect(await bundles.findById(bundle.id)).toBeNull();
        expect(await bundles.existsWithProduct(product.id)).toBe(false);
      });

      it('refuza salvarea pachetelor imbricate (nu se pot reprezenta)', async () => {
        const product = await newProduct({ name: 'PY' });
        const inner = await newBundle([{ productId: product.id, quantity: 1 }]);
        const outer = Bundle.create({
          id: randomUUID(),
          name: `${tag} Exterior`,
          description: '',
          discountPercent: 0,
          components: [{ item: inner, quantity: 1 }],
        });
        await expect(bundles.save(outer)).rejects.toMatchObject({
          code: 'NESTED_BUNDLE_NOT_SUPPORTED',
        });
      });
    });
  });
}

function inMemoryHarness(withCache: boolean): Harness {
  const raw = new InMemoryProductRepository();
  const products = withCache ? new CachingProductRepository(raw) : raw;
  return {
    products,
    categories: new InMemoryCategoryRepository(),
    bundles: new InMemoryBundleRepository(products),
    cleanup: () => Promise.resolve(),
  };
}

const databaseUrl = process.env['DATABASE_URL'];

function prismaHarness(): Harness {
  const prisma = createPrismaClient(databaseUrl ?? 'postgresql://invalid');
  return {
    products: new CachingProductRepository(new PrismaProductRepository(prisma)),
    categories: new PrismaCategoryRepository(prisma),
    bundles: new PrismaBundleRepository(prisma),
    cleanup: () => prisma.$disconnect(),
  };
}

repositoryContract('in-memory', () => inMemoryHarness(false));
repositoryContract('in-memory + CachingProductRepository (Proxy)', () => inMemoryHarness(true));
// Ruleaza doar cu DATABASE_URL setat si PostgreSQL pornit (`docker compose up -d`).
repositoryContract('Prisma/PostgreSQL (+ proxy cu cache)', prismaHarness, Boolean(databaseUrl));
