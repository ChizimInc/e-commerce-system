import type { Bundle } from '../../domain/Bundle';
import type { CatalogItem } from '../../domain/CatalogItem';
import type { CategoryNode } from '../../domain/Category';
import type { Product } from '../../domain/Product';

export interface ListProductsQuery {
  /** Cautare text in nume/descriere. */
  readonly query?: string | undefined;
  /** Filtreaza dupa categorie (include subcategoriile ei). */
  readonly categoryId?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface ProductPage {
  readonly items: Product[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Port de intrare: operatiile publice (de citire) ale catalogului. */
export interface CatalogQueries {
  listProducts(query: ListProductsQuery): Promise<ProductPage>;
  /** Arunca `NotFoundError` daca produsul nu exista. */
  getProduct(id: string): Promise<Product>;
  listCategories(): Promise<CategoryNode[]>;
  listBundles(): Promise<Bundle[]>;
  /** Arunca `NotFoundError` daca pachetul nu exista. */
  getBundle(id: string): Promise<Bundle>;
  /** Produs sau pachet dupa id (tratat uniform, ca `CatalogItem`); `null` daca nu exista. */
  findItem(id: string): Promise<CatalogItem | null>;
}
