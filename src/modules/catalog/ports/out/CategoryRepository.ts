import type { Category } from '../../domain/Category';

/** Port de iesire pentru persistenta categoriilor. */
export interface CategoryRepository {
  findById(id: string): Promise<Category | null>;
  findAll(): Promise<Category[]>;
  /** Insereaza sau actualizeaza (upsert). */
  save(category: Category): Promise<void>;
  /** Intoarce `false` daca categoria nu exista. */
  delete(id: string): Promise<boolean>;
}
