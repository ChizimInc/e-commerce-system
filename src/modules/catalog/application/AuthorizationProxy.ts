import { ForbiddenError, UnauthorizedError, type Logger, type Principal } from '../../../shared';
import type { Bundle } from '../domain/Bundle';
import type { Category } from '../domain/Category';
import type { Product } from '../domain/Product';
import type {
  CatalogAdminService,
  CreateBundleInput,
  CreateCategoryInput,
  CreateProductInput,
  UpdateBundleInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from '../ports/in/CatalogAdminService';

// Pattern: Proxy (Structural) – proxy de protectie: verifica rolul ADMIN inainte de a delega catre CatalogAdminService, independent de middleware-ul HTTP
export class AuthorizationProxy implements CatalogAdminService {
  /**
   * @param target subiectul real (cazurile de utilizare de administrare)
   * @param principal apelantul (`null` = anonim)
   * @param logger optional: inregistreaza incercarile respinse
   */
  constructor(
    private readonly target: CatalogAdminService,
    private readonly principal: Principal | null,
    private readonly logger?: Logger,
  ) {}

  createProduct(input: CreateProductInput): Promise<Product> {
    return this.guard('createProduct', () => this.target.createProduct(input));
  }

  updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
    return this.guard('updateProduct', () => this.target.updateProduct(id, input));
  }

  deleteProduct(id: string): Promise<void> {
    return this.guard('deleteProduct', () => this.target.deleteProduct(id));
  }

  createCategory(input: CreateCategoryInput): Promise<Category> {
    return this.guard('createCategory', () => this.target.createCategory(input));
  }

  updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    return this.guard('updateCategory', () => this.target.updateCategory(id, input));
  }

  deleteCategory(id: string): Promise<void> {
    return this.guard('deleteCategory', () => this.target.deleteCategory(id));
  }

  createBundle(input: CreateBundleInput): Promise<Bundle> {
    return this.guard('createBundle', () => this.target.createBundle(input));
  }

  updateBundle(id: string, input: UpdateBundleInput): Promise<Bundle> {
    return this.guard('updateBundle', () => this.target.updateBundle(id, input));
  }

  deleteBundle(id: string): Promise<void> {
    return this.guard('deleteBundle', () => this.target.deleteBundle(id));
  }

  /** Singurul punct de decizie: nimic nu ajunge la subiectul real fara rolul ADMIN. */
  private async guard<T>(operation: string, action: () => Promise<T>): Promise<T> {
    if (!this.principal) {
      this.logger?.warn('Operatie de administrare respinsa: apelant neautentificat', { operation });
      throw new UnauthorizedError();
    }
    if (this.principal.role !== 'ADMIN') {
      this.logger?.warn('Operatie de administrare respinsa: rol insuficient', {
        operation,
        userId: this.principal.userId,
        role: this.principal.role,
      });
      throw new ForbiddenError();
    }
    return await action();
  }
}
