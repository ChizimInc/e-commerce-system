import { describe, expect, it } from 'vitest';
import { CachingProductRepository } from '../../../src/modules/catalog/adapters/persistence/CachingProductRepository';
import { InMemoryProductRepository } from '../../../src/modules/catalog/adapters/persistence/InMemoryProductRepository';
import type { Product } from '../../../src/modules/catalog/domain/Product';
import type {
  Page,
  ProductFilter,
  ProductRepository,
} from '../../../src/modules/catalog/ports/out/ProductRepository';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';

/** Repository real simulat: numara cate apeluri de citire ajung efectiv la el. */
class CountingRepository implements ProductRepository {
  readonly calls = { findById: 0, findByIds: 0, findMany: 0 };
  readonly inner = new InMemoryProductRepository();
  /** Daca e setat, `findById` se blocheaza (dupa ce a citit) pana cand promisiunea se rezolva. */
  gate: Promise<void> | undefined;

  async findById(id: string): Promise<Product | null> {
    this.calls.findById++;
    const result = await this.inner.findById(id);
    if (this.gate) await this.gate;
    return result;
  }
  findByIds(ids: readonly string[]): Promise<Product[]> {
    this.calls.findByIds++;
    return this.inner.findByIds(ids);
  }
  findMany(filter: ProductFilter): Promise<Page<Product>> {
    this.calls.findMany++;
    return this.inner.findMany(filter);
  }
  save(product: Product): Promise<void> {
    return this.inner.save(product);
  }
  delete(id: string): Promise<boolean> {
    return this.inner.delete(id);
  }
  countByCategories(ids: readonly string[]): Promise<number> {
    return this.inner.countByCategories(ids);
  }
}

const listAll: ProductFilter = { limit: 20, offset: 0 };

// Proxy (S4): citiri repetate servite din cache, invalidare la scriere, acelasi contract ca repository-ul real.
describe('CachingProductRepository (Proxy)', () => {
  it('serveste a doua citire dupa id din cache, fara sa mai atinga repository-ul real', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1) }));
    const cached = new CachingProductRepository(real);

    const first = await cached.findById(uuid(1));
    const second = await cached.findById(uuid(1));

    expect(second).toBe(first);
    expect(real.calls.findById).toBe(1);
  });

  it('serveste listele identice din cache, dar listele diferite merg la repository', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1), name: 'Mouse' }));
    const cached = new CachingProductRepository(real);

    await cached.findMany(listAll);
    await cached.findMany(listAll);
    expect(real.calls.findMany).toBe(1);

    await cached.findMany({ ...listAll, query: 'mou' });
    expect(real.calls.findMany).toBe(2);
  });

  it('invalideaza la save: o citire dupa scriere vede datele noi', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1), name: 'Vechi' }));
    const cached = new CachingProductRepository(real);
    await cached.findById(uuid(1));
    await cached.findMany(listAll);

    await cached.save(makeProduct({ id: uuid(1), name: 'Nou' }));

    expect((await cached.findById(uuid(1)))?.name).toBe('Nou');
    expect((await cached.findMany(listAll)).items.map((p) => p.name)).toEqual(['Nou']);
  });

  it('invalideaza la delete', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1) }));
    const cached = new CachingProductRepository(real);
    await cached.findById(uuid(1));
    await cached.findMany(listAll);

    expect(await cached.delete(uuid(1))).toBe(true);

    expect(await cached.findById(uuid(1))).toBeNull();
    expect((await cached.findMany(listAll)).total).toBe(0);
  });

  it('nu tine in cache rezultatele lipsa (un produs creat ulterior se gaseste imediat)', async () => {
    const real = new CountingRepository();
    const cached = new CachingProductRepository(real);
    expect(await cached.findById(uuid(1))).toBeNull();
    await real.save(makeProduct({ id: uuid(1) })); // scris direct, pe langa proxy
    expect(await cached.findById(uuid(1))).not.toBeNull();
  });

  it('intrarile expira dupa TTL', async () => {
    let now = 1_000;
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1) }));
    const cached = new CachingProductRepository(real, { ttlMs: 100, now: () => now });

    await cached.findById(uuid(1));
    now += 99;
    await cached.findById(uuid(1));
    expect(real.calls.findById).toBe(1);

    now += 1;
    await cached.findById(uuid(1));
    expect(real.calls.findById).toBe(2);
  });

  it('findByIds citeste din repository doar produsele care lipsesc din cache', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1) }));
    await real.save(makeProduct({ id: uuid(2), name: 'B' }));
    const cached = new CachingProductRepository(real);
    await cached.findById(uuid(1)); // uuid(1) intra in cache

    const found = await cached.findByIds([uuid(1), uuid(2)]);

    expect(found.map((p) => p.id).sort()).toEqual([uuid(1), uuid(2)]);
    expect(real.calls.findByIds).toBe(1);
    await cached.findByIds([uuid(1), uuid(2)]);
    expect(real.calls.findByIds).toBe(1); // acum ambele sunt in cache
  });

  it('limiteaza dimensiunea cache-ului (elimina cea mai veche intrare)', async () => {
    const real = new CountingRepository();
    for (const n of [1, 2, 3]) await real.save(makeProduct({ id: uuid(n), name: `P${n}` }));
    const cached = new CachingProductRepository(real, { maxEntries: 2 });

    for (const n of [1, 2, 3]) await cached.findById(uuid(n)); // uuid(1) e eliminat
    expect(real.calls.findById).toBe(3);
    await cached.findById(uuid(3));
    await cached.findById(uuid(2));
    expect(real.calls.findById).toBe(3); // 2 si 3 sunt in cache
    await cached.findById(uuid(1));
    expect(real.calls.findById).toBe(4); // 1 a fost eliminat
  });

  it('o citire inceputa inainte de o scriere nu mai populeaza cache-ul cu date vechi', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1), name: 'Vechi' }));
    const cached = new CachingProductRepository(real);

    let release!: () => void;
    real.gate = new Promise<void>((resolve) => (release = resolve));
    const slowRead = cached.findById(uuid(1)); // a citit deja "Vechi" si asteapta
    await Promise.resolve();
    real.gate = undefined;
    await cached.save(makeProduct({ id: uuid(1), name: 'Nou' })); // invalideaza
    release();
    expect((await slowRead)?.name).toBe('Vechi'); // citirea in curs isi pastreaza rezultatul...

    expect((await cached.findById(uuid(1)))?.name).toBe('Nou'); // ...dar nu a ramas in cache
  });

  it('apelantii primesc o copie a listei: modificarea ei nu corupe cache-ul', async () => {
    const real = new CountingRepository();
    await real.save(makeProduct({ id: uuid(1), name: 'A' }));
    await real.save(makeProduct({ id: uuid(2), name: 'B' }));
    const cached = new CachingProductRepository(real);

    const first = await cached.findMany(listAll);
    first.items.reverse();
    first.items.pop();

    const second = await cached.findMany(listAll);
    expect(second.items.map((p) => p.name)).toEqual(['A', 'B']);
    expect(real.calls.findMany).toBe(1); // a doua citire a venit din cache
  });

  it('countByCategories nu foloseste cache-ul', async () => {
    const real = new CountingRepository();
    const cached = new CachingProductRepository(real);
    expect(await cached.countByCategories([uuid(5)])).toBe(0);
    await real.save(makeProduct({ id: uuid(1), categoryId: uuid(5) }));
    expect(await cached.countByCategories([uuid(5)])).toBe(1);
  });
});
