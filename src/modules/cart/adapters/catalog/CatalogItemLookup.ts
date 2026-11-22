import type { CatalogQueries } from '../../../catalog/ports/in/CatalogQueries';
import type { CatalogLookup, PurchasableItem } from '../../ports/out/CatalogLookup';

/**
 * Anti-corruption layer: traduce modelul catalogului (`CatalogItem`: produs sau pachet, tratate
 * uniform prin Composite) in modelul minimal de care are nevoie cosul.
 */
export class CatalogItemLookup implements CatalogLookup {
  constructor(private readonly catalog: CatalogQueries) {}

  async find(itemId: string): Promise<PurchasableItem | null> {
    const item = await this.catalog.findItem(itemId);
    if (!item) return null;
    return {
      id: item.id,
      name: item.name,
      unitPrice: item.getPrice(),
      availableStock: item.availableStock(),
    };
  }
}
