import type { CatalogQueries } from '../../../catalog/ports/in/CatalogQueries';
import type { OrderCatalog, OrderableItem } from '../../ports/out/OrderCatalog';

/**
 * Anti-corruption layer: traduce modelul catalogului (`CatalogItem`: produs sau pachet, tratate
 * uniform prin Composite) in ce are nevoie comanda: pret, stoc si produsele de la care se scade stocul.
 */
export class CatalogOrderLookup implements OrderCatalog {
  constructor(private readonly catalog: CatalogQueries) {}

  async find(itemId: string): Promise<OrderableItem | null> {
    const item = await this.catalog.findItem(itemId);
    if (!item) return null;
    return {
      id: item.id,
      name: item.name,
      unitPrice: item.getPrice(),
      availableStock: item.availableStock(),
      stockPerUnit: item.stockRequirements(),
    };
  }
}
