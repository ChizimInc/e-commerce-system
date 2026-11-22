import type { Product } from '../../domain/Product';
import type { Page, ProductFilter, ProductRepository } from '../../ports/out/ProductRepository';

/** Adaptor in-memory pentru `ProductRepository` (teste si demo fara baza de date). */
export class InMemoryProductRepository implements ProductRepository {
  private readonly store = new Map<string, Product>();

  findById(id: string): Promise<Product | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findByIds(ids: readonly string[]): Promise<Product[]> {
    const found = new Set<Product>();
    for (const id of ids) {
      const product = this.store.get(id);
      if (product) found.add(product);
    }
    return Promise.resolve([...found]);
  }

  findMany(filter: ProductFilter): Promise<Page<Product>> {
    const text = filter.query?.toLowerCase();
    const categories = filter.categoryIds ? new Set(filter.categoryIds) : undefined;
    const matching = [...this.store.values()]
      .filter((product) => {
        if (categories && (product.categoryId === null || !categories.has(product.categoryId))) {
          return false;
        }
        if (text) {
          return (
            product.name.toLowerCase().includes(text) ||
            product.description.toLowerCase().includes(text)
          );
        }
        return true;
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
    return Promise.resolve({
      items: matching.slice(filter.offset, filter.offset + filter.limit),
      total: matching.length,
    });
  }

  save(product: Product): Promise<void> {
    this.store.set(product.id, product);
    return Promise.resolve();
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.store.delete(id));
  }

  countByCategories(categoryIds: readonly string[]): Promise<number> {
    const categories = new Set(categoryIds);
    let count = 0;
    for (const product of this.store.values()) {
      if (product.categoryId !== null && categories.has(product.categoryId)) count++;
    }
    return Promise.resolve(count);
  }
}
