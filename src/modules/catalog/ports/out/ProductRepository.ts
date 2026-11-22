import type { Product } from '../../domain/Product';

export interface ProductFilter {
  /** Text cautat (fara diferenta intre litere mari/mici) in numele si descrierea produsului. */
  readonly query?: string | undefined;
  /**
   * Restrange rezultatele la aceste categorii. `undefined` = fara filtru;
   * lista goala = nicio categorie (deci niciun rezultat).
   */
  readonly categoryIds?: readonly string[] | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: T[];
  /** Numarul total de rezultate, indiferent de paginare. */
  readonly total: number;
}

/** Port de iesire pentru persistenta produselor (adaptoare: in-memory, Prisma, proxy cu cache). */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findByIds(ids: readonly string[]): Promise<Product[]>;
  /** Rezultate sortate dupa nume, apoi dupa id (ordine stabila pentru paginare). */
  findMany(filter: ProductFilter): Promise<Page<Product>>;
  /** Insereaza sau actualizeaza (upsert). */
  save(product: Product): Promise<void>;
  /** Intoarce `false` daca produsul nu exista. */
  delete(id: string): Promise<boolean>;
  countByCategories(categoryIds: readonly string[]): Promise<number>;
}
