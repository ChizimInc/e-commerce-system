import type { Category } from '../../domain/Category';
import type { CategoryRepository } from '../../ports/out/CategoryRepository';

/** Adaptor in-memory pentru `CategoryRepository`. */
export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new Map<string, Category>();

  findById(id: string): Promise<Category | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findAll(): Promise<Category[]> {
    return Promise.resolve([...this.store.values()]);
  }

  save(category: Category): Promise<void> {
    this.store.set(category.id, category);
    return Promise.resolve();
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.store.delete(id));
  }
}
