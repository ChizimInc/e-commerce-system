import { Bundle } from '../../domain/Bundle';
import type { BundleRepository } from '../../ports/out/BundleRepository';
import type { ProductRepository } from '../../ports/out/ProductRepository';

interface StoredBundle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly discountPercent: number;
  readonly components: readonly { productId: string; quantity: number }[];
}

/**
 * Adaptor in-memory pentru `BundleRepository`. Ca si varianta SQL, pastreaza doar legaturile
 * pachet -> produs si reconstruieste pachetul cu produsele curente (preturi/stoc proaspete).
 */
export class InMemoryBundleRepository implements BundleRepository {
  private readonly store = new Map<string, StoredBundle>();

  constructor(private readonly products: ProductRepository) {}

  async findById(id: string): Promise<Bundle | null> {
    const stored = this.store.get(id);
    return stored ? this.hydrate(stored) : null;
  }

  async findAll(): Promise<Bundle[]> {
    return Promise.all([...this.store.values()].map((stored) => this.hydrate(stored)));
  }

  save(bundle: Bundle): Promise<void> {
    // In promisiune, ca erorile (ex. pachete imbricate) sa fie respingeri, ca la adaptorul SQL.
    return Promise.resolve().then(() => {
      this.store.set(bundle.id, {
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        discountPercent: bundle.discountPercent,
        components: bundle
          .productComponents()
          .map(({ product, quantity }) => ({ productId: product.id, quantity })),
      });
    });
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.store.delete(id));
  }

  existsWithProduct(productId: string): Promise<boolean> {
    for (const stored of this.store.values()) {
      if (stored.components.some((component) => component.productId === productId)) {
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  private async hydrate(stored: StoredBundle): Promise<Bundle> {
    const products = await this.products.findByIds(stored.components.map((c) => c.productId));
    const byId = new Map(products.map((product) => [product.id, product]));
    return Bundle.create({
      id: stored.id,
      name: stored.name,
      description: stored.description,
      discountPercent: stored.discountPercent,
      components: stored.components.map(({ productId, quantity }) => {
        const product = byId.get(productId);
        if (!product) {
          throw new Error(`Date inconsistente: pachetul ${stored.id} refera produsul ${productId}`);
        }
        return { item: product, quantity };
      }),
    });
  }
}
