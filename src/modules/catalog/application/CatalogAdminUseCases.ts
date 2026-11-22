import {
  ConflictError,
  Money,
  NotFoundError,
  type IdGenerator,
  type Logger,
} from '../../../shared';
import { Bundle, type BundleComponent } from '../domain/Bundle';
import { Category, CategoryTree } from '../domain/Category';
import { Product } from '../domain/Product';
import type {
  BundleItemInput,
  CatalogAdminService,
  CreateBundleInput,
  CreateCategoryInput,
  CreateProductInput,
  UpdateBundleInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from '../ports/in/CatalogAdminService';
import type { BundleRepository } from '../ports/out/BundleRepository';
import type { CategoryRepository } from '../ports/out/CategoryRepository';
import type { ProductRepository } from '../ports/out/ProductRepository';

/**
 * Cazurile de utilizare de administrare a catalogului (CRUD). Este subiectul real din spatele
 * `AuthorizationProxy`: nu verifica drepturile, ci doar regulile de business (referinte valide,
 * fara cicluri in categorii, fara stergerea resurselor folosite).
 */
export class CatalogAdminUseCases implements CatalogAdminService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly bundles: BundleRepository,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  // ---- Produse ----

  async createProduct(input: CreateProductInput): Promise<Product> {
    const categoryId = input.categoryId ?? null;
    await this.assertCategoryExists(categoryId);
    const product = Product.create({
      id: this.ids.next(),
      name: input.name,
      description: input.description ?? '',
      price: Money.of(input.price.amount, input.price.currency),
      stock: input.stock,
      categoryId,
    });
    await this.products.save(product);
    this.logger.info('Produs creat', { productId: product.id });
    return product;
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
    const existing = await this.products.findById(id);
    if (!existing) throw new NotFoundError('Produs', id);
    if (input.categoryId !== undefined) {
      await this.assertCategoryExists(input.categoryId);
    }
    if (
      input.price &&
      input.price.currency !== existing.price.currency &&
      (await this.bundles.existsWithProduct(id))
    ) {
      // Un pachet cu componente in monede diferite nu se mai poate calcula (si ar strica listarea).
      throw new ConflictError(
        'Moneda unui produs din pachet nu se poate schimba: scoate-l intai din pachete',
        'PRODUCT_IN_BUNDLE',
      );
    }
    const updated = existing.withChanges({
      name: input.name,
      description: input.description,
      price: input.price && Money.of(input.price.amount, input.price.currency),
      stock: input.stock,
      categoryId: input.categoryId,
    });
    await this.products.save(updated);
    this.logger.info('Produs actualizat', { productId: id });
    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    if (await this.bundles.existsWithProduct(id)) {
      throw new ConflictError(
        'Produsul face parte dintr-un pachet si nu poate fi sters',
        'PRODUCT_IN_BUNDLE',
      );
    }
    if (!(await this.products.delete(id))) throw new NotFoundError('Produs', id);
    this.logger.info('Produs sters', { productId: id });
  }

  // ---- Categorii ----

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    const parentId = input.parentId ?? null;
    const all = await this.categories.findAll();
    this.assertParentExists(all, parentId);
    const category = Category.create({ id: this.ids.next(), name: input.name, parentId });
    this.assertUniqueSiblingName(all, category);
    await this.categories.save(category);
    this.logger.info('Categorie creata', { categoryId: category.id });
    return category;
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    const all = await this.categories.findAll();
    const existing = all.find((category) => category.id === id);
    if (!existing) throw new NotFoundError('Categorie', id);
    const updated = existing.withChanges({ name: input.name, parentId: input.parentId });
    if (updated.parentId !== null) {
      this.assertParentExists(all, updated.parentId);
      if (CategoryTree.from(all).subtreeIds(id).includes(updated.parentId)) {
        throw new ConflictError(
          'Categoria nu poate fi mutata sub propriul subarbore (ciclu in ierarhie)',
          'CATEGORY_CYCLE',
        );
      }
    }
    this.assertUniqueSiblingName(all, updated);
    await this.categories.save(updated);
    this.logger.info('Categorie actualizata', { categoryId: id });
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    const all = await this.categories.findAll();
    if (!all.some((category) => category.id === id)) throw new NotFoundError('Categorie', id);
    if (CategoryTree.from(all).hasChildren(id)) {
      throw new ConflictError(
        'Categoria are subcategorii si nu poate fi stearsa',
        'CATEGORY_NOT_EMPTY',
      );
    }
    if ((await this.products.countByCategories([id])) > 0) {
      throw new ConflictError(
        'Categoria contine produse si nu poate fi stearsa',
        'CATEGORY_NOT_EMPTY',
      );
    }
    await this.categories.delete(id);
    this.logger.info('Categorie stearsa', { categoryId: id });
  }

  // ---- Pachete ----

  async createBundle(input: CreateBundleInput): Promise<Bundle> {
    const bundle = Bundle.create({
      id: this.ids.next(),
      name: input.name,
      description: input.description ?? '',
      discountPercent: input.discountPercent ?? 0,
      components: await this.resolveComponents(input.items),
    });
    await this.bundles.save(bundle);
    this.logger.info('Pachet creat', { bundleId: bundle.id });
    return bundle;
  }

  async updateBundle(id: string, input: UpdateBundleInput): Promise<Bundle> {
    const existing = await this.bundles.findById(id);
    if (!existing) throw new NotFoundError('Pachet', id);
    const updated = existing.withChanges({
      name: input.name,
      description: input.description,
      discountPercent: input.discountPercent,
      components: input.items && (await this.resolveComponents(input.items)),
    });
    await this.bundles.save(updated);
    this.logger.info('Pachet actualizat', { bundleId: id });
    return updated;
  }

  async deleteBundle(id: string): Promise<void> {
    if (!(await this.bundles.delete(id))) throw new NotFoundError('Pachet', id);
    this.logger.info('Pachet sters', { bundleId: id });
  }

  // ---- ajutatoare ----

  private async assertCategoryExists(categoryId: string | null): Promise<void> {
    if (categoryId !== null && !(await this.categories.findById(categoryId))) {
      throw new NotFoundError('Categorie', categoryId);
    }
  }

  private assertParentExists(all: readonly Category[], parentId: string | null): void {
    if (parentId !== null && !all.some((category) => category.id === parentId)) {
      throw new NotFoundError('Categorie', parentId);
    }
  }

  private assertUniqueSiblingName(all: readonly Category[], candidate: Category): void {
    const name = candidate.name.toLowerCase();
    const clash = all.some(
      (other) =>
        other.id !== candidate.id &&
        other.parentId === candidate.parentId &&
        other.name.toLowerCase() === name,
    );
    if (clash) {
      throw new ConflictError(
        `Exista deja o categorie cu numele "${candidate.name}" in acelasi nivel`,
        'CATEGORY_NAME_TAKEN',
      );
    }
  }

  private async resolveComponents(items: readonly BundleItemInput[]): Promise<BundleComponent[]> {
    const found = await this.products.findByIds(items.map((item) => item.productId));
    const byId = new Map(found.map((product) => [product.id, product]));
    return items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) throw new NotFoundError('Produs', item.productId);
      return { item: product, quantity: item.quantity };
    });
  }
}
