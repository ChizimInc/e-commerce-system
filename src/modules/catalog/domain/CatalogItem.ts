import type { Money } from '../../../shared';

/**
 * Componenta comuna a structurii Composite: atat `Product` (frunza), cat si `Bundle` (compus)
 * se pot trata uniform de catre client (pret, stoc disponibil), fara sa stie de ce tip sunt.
 */
export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  /** Pretul unitar al elementului (la `Bundle`: calculat din componente). */
  getPrice(): Money;
  /** Cate unitati se pot vinde acum (la `Bundle`: limitat de componenta cea mai slaba). */
  availableStock(): number;
  /**
   * Produsele simple al caror stoc se consuma pentru O bucata din acest element, cu cantitatea
   * fiecaruia (la `Product`: el insusi; la `Bundle`: componentele lui, recursiv).
   */
  stockRequirements(): StockRequirement[];
}

export interface StockRequirement {
  readonly productId: string;
  readonly quantity: number;
}
