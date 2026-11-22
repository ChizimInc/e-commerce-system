import { NotFoundError } from '../../../shared';
import type { Bundle } from '../domain/Bundle';
import type { CatalogItem } from '../domain/CatalogItem';
import { CategoryTree, type CategoryNode } from '../domain/Category';
import type { Product } from '../domain/Product';
import type { CatalogQueries, ListProductsQuery, ProductPage } from '../ports/in/CatalogQueries';
import type { BundleRepository } from '../ports/out/BundleRepository';
import type { CategoryRepository } from '../ports/out/CategoryRepository';
import type { ProductRepository } from '../ports/out/ProductRepository';

/** Cazuri de utilizare de citire ale catalogului: listare/cautare/filtrare, detalii, categorii, pachete. */
export class CatalogQueryService implements CatalogQueries {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly bundles: BundleRepository,
  ) {}

  async listProducts(query: ListProductsQuery): Promise<ProductPage> {
    let categoryIds: string[] | undefined;
    if (query.categoryId !== undefined) {
      // Filtrarea pe o categorie include si subcategoriile ei.
      const tree = CategoryTree.from(await this.categories.findAll());
      if (!tree.has(query.categoryId)) {
        throw new NotFoundError('Categorie', query.categoryId);
      }
      categoryIds = tree.subtreeIds(query.categoryId);
    }
    const text = query.query?.trim();
    const page = await this.products.findMany({
      query: text ? text : undefined,
      categoryIds,
      limit: query.limit,
      offset: query.offset,
    });
    return { ...page, limit: query.limit, offset: query.offset };
  }

  async getProduct(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundError('Produs', id);
    return product;
  }

  async listCategories(): Promise<CategoryNode[]> {
    return CategoryTree.from(await this.categories.findAll()).toNodes();
  }

  async listBundles(): Promise<Bundle[]> {
    const bundles = await this.bundles.findAll();
    return bundles.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async getBundle(id: string): Promise<Bundle> {
    const bundle = await this.bundles.findById(id);
    if (!bundle) throw new NotFoundError('Pachet', id);
    return bundle;
  }

  async findItem(id: string): Promise<CatalogItem | null> {
    return (await this.products.findById(id)) ?? (await this.bundles.findById(id));
  }
}
