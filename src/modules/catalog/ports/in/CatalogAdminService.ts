import type { Currency } from '../../../../shared';
import type { Bundle } from '../../domain/Bundle';
import type { Category } from '../../domain/Category';
import type { Product } from '../../domain/Product';

export interface PriceInput {
  /** Suma in cenți (numar intreg). */
  readonly amount: number;
  readonly currency: Currency;
}

export interface CreateProductInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly price: PriceInput;
  readonly stock: number;
  readonly categoryId?: string | null | undefined;
}

export interface UpdateProductInput {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly price?: PriceInput | undefined;
  readonly stock?: number | undefined;
  readonly categoryId?: string | null | undefined;
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly parentId?: string | null | undefined;
}

export interface UpdateCategoryInput {
  readonly name?: string | undefined;
  readonly parentId?: string | null | undefined;
}

export interface BundleItemInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface CreateBundleInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly discountPercent?: number | undefined;
  readonly items: readonly BundleItemInput[];
}

export interface UpdateBundleInput {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly discountPercent?: number | undefined;
  readonly items?: readonly BundleItemInput[] | undefined;
}

/**
 * Port de intrare: operatiile de administrare ale catalogului (CRUD produse, categorii, pachete).
 * Implementat de `CatalogAdminUseCases` (subiectul real) si de `AuthorizationProxy` (care il
 * protejeaza prin verificarea rolului).
 */
export interface CatalogAdminService {
  createProduct(input: CreateProductInput): Promise<Product>;
  updateProduct(id: string, input: UpdateProductInput): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  createCategory(input: CreateCategoryInput): Promise<Category>;
  updateCategory(id: string, input: UpdateCategoryInput): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  createBundle(input: CreateBundleInput): Promise<Bundle>;
  updateBundle(id: string, input: UpdateBundleInput): Promise<Bundle>;
  deleteBundle(id: string): Promise<void>;
}
