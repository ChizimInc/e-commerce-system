import type { Product } from '../../domain/Product';
import type { Page, ProductFilter, ProductRepository } from '../../ports/out/ProductRepository';

export interface CachingOptions {
  /** Cat timp ramane valida o intrare din cache (implicit 60 s). */
  readonly ttlMs?: number;
  /** Numarul maxim de intrari pe fiecare tip de cache (implicit 500); cele mai vechi se elimina. */
  readonly maxEntries?: number;
  /** Sursa de timp (injectabila in teste). */
  readonly now?: () => number;
}

interface Entry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** Apelantii primesc o copie: modificarea lor (ex. sortare in loc) nu poate corupe cache-ul. */
function copyOf(page: Page<Product>): Page<Product> {
  return { items: [...page.items], total: page.total };
}

// Pattern: Proxy (Structural) – proxy cu cache peste ProductRepository: serveste citirile repetate din memorie si invalideaza la scriere, fara sa modifice repository-ul real
export class CachingProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Entry<Product>>();
  private readonly lists = new Map<string, Entry<Page<Product>>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  /** Creste la fiecare invalidare; o citire inceputa inainte de o scriere nu mai are voie sa populeze cache-ul. */
  private generation = 0;

  constructor(
    private readonly target: ProductRepository,
    options: CachingOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  async findById(id: string): Promise<Product | null> {
    const cached = this.read(this.byId, id);
    if (cached) return cached;
    const generation = this.generation;
    const product = await this.target.findById(id);
    if (product && generation === this.generation) this.write(this.byId, id, product);
    return product;
  }

  async findByIds(ids: readonly string[]): Promise<Product[]> {
    const result = new Map<string, Product>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const cached = this.read(this.byId, id);
      if (cached) result.set(id, cached);
      else missing.push(id);
    }
    if (missing.length > 0) {
      const generation = this.generation;
      for (const product of await this.target.findByIds(missing)) {
        if (generation === this.generation) this.write(this.byId, product.id, product);
        result.set(product.id, product);
      }
    }
    return [...result.values()];
  }

  async findMany(filter: ProductFilter): Promise<Page<Product>> {
    const key = JSON.stringify([
      filter.query ?? null,
      filter.categoryIds ?? null,
      filter.limit,
      filter.offset,
    ]);
    const cached = this.read(this.lists, key);
    if (cached) return copyOf(cached);
    const generation = this.generation;
    const page = await this.target.findMany(filter);
    if (generation === this.generation) this.write(this.lists, key, page);
    return copyOf(page);
  }

  async save(product: Product): Promise<void> {
    await this.target.save(product);
    this.invalidate(product.id);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.target.delete(id);
    this.invalidate(id);
    return deleted;
  }

  countByCategories(categoryIds: readonly string[]): Promise<number> {
    // Verificarile de integritate (ex. stergerea unei categorii) trebuie sa vada datele reale.
    return this.target.countByCategories(categoryIds);
  }

  /**
   * Invalidare din exterior: produsele s-au schimbat fara sa treaca prin acest proxy
   * (ex. plasarea unei comenzi le scade stocul direct in baza de date).
   */
  evict(ids: readonly string[]): void {
    this.invalidate(...ids);
  }

  /** Orice scriere invalideaza produsul si toate listele (pot contine produsul sau ordinea lui). */
  private invalidate(...ids: string[]): void {
    this.generation++;
    for (const id of ids) this.byId.delete(id);
    this.lists.clear();
  }

  private read<T>(cache: Map<string, Entry<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private write<T>(cache: Map<string, Entry<T>>, key: string, value: T): void {
    cache.delete(key); // reinsereaza la sfarsit, ca sa fie cea mai noua
    cache.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (cache.size > this.maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  }
}
