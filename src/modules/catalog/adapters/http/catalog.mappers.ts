import type { z } from 'zod';
import type { Bundle } from '../../domain/Bundle';
import type { Category } from '../../domain/Category';
import type { Product } from '../../domain/Product';
import type { ProductPage } from '../../ports/in/CatalogQueries';
import type {
  bundleResponseSchema,
  categoryResponseSchema,
  productPageResponseSchema,
  productResponseSchema,
} from './catalog.schemas';

/** Traduce obiectele de domeniu in forma JSON expusa de API (domeniul nu stie de HTTP). */

export function toProductResponse(product: Product): z.infer<typeof productResponseSchema> {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toJSON(),
    stock: product.stock,
    categoryId: product.categoryId,
  };
}

export function toProductPageResponse(
  page: ProductPage,
): z.infer<typeof productPageResponseSchema> {
  return {
    items: page.items.map(toProductResponse),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

export function toCategoryResponse(category: Category): z.infer<typeof categoryResponseSchema> {
  return { id: category.id, name: category.name, parentId: category.parentId };
}

export function toBundleResponse(bundle: Bundle): z.infer<typeof bundleResponseSchema> {
  return {
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    discountPercent: bundle.discountPercent,
    price: bundle.getPrice().toJSON(),
    availableStock: bundle.availableStock(),
    items: bundle.components.map(({ item, quantity }) => ({
      productId: item.id,
      name: item.name,
      quantity,
      unitPrice: item.getPrice().toJSON(),
    })),
  };
}
