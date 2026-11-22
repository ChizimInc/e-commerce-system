import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../../../shared';
import { moneySchema } from '../../../../infrastructure/http/common-schemas';
import {
  MAX_BUNDLE_COMPONENTS,
  MAX_BUNDLE_DISCOUNT_PERCENT,
  MAX_COMPONENT_QUANTITY,
} from '../../domain/Bundle';
import { MAX_PRICE_CENTS, MAX_STOCK } from '../../domain/Product';

// ---- Cereri (validare la marginea sistemului + sursa documentatiei) ----

const nonEmptyUpdate = (value: object): boolean => Object.keys(value).length > 0;
const NON_EMPTY_UPDATE_MESSAGE = 'Trimite cel putin un camp de modificat';

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(100).optional().describe('Text cautat in nume si descriere'),
  categoryId: z.uuid().optional().describe('Filtreaza dupa categorie (include subcategoriile)'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const priceInputSchema = z
  .object({
    amount: z.number().int().min(0).max(MAX_PRICE_CENTS).describe('Pret in cenți'),
    currency: z.enum(SUPPORTED_CURRENCIES),
  })
  .strict();

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    price: priceInputSchema,
    stock: z.number().int().min(0).max(MAX_STOCK),
    categoryId: z.uuid().nullable().optional(),
  })
  .strict();

export const updateProductSchema = createProductSchema
  .partial()
  .refine(nonEmptyUpdate, NON_EMPTY_UPDATE_MESSAGE);

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    parentId: z.uuid().nullable().optional(),
  })
  .strict();

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine(nonEmptyUpdate, NON_EMPTY_UPDATE_MESSAGE);

const bundleItemsSchema = z
  .array(
    z
      .object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(MAX_COMPONENT_QUANTITY),
      })
      .strict(),
  )
  .min(1)
  .max(MAX_BUNDLE_COMPONENTS)
  .refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    'Un produs poate aparea o singura data in pachet',
  );

export const createBundleSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    discountPercent: z.number().int().min(0).max(MAX_BUNDLE_DISCOUNT_PERCENT).optional(),
    items: bundleItemsSchema,
  })
  .strict();

export const updateBundleSchema = createBundleSchema
  .partial()
  .refine(nonEmptyUpdate, NON_EMPTY_UPDATE_MESSAGE);

// ---- Raspunsuri (folosite pentru documentatie si pentru testele de contract) ----

export const productResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  price: moneySchema,
  stock: z.int().min(0).meta({ example: 10 }),
  categoryId: z.uuid().nullable(),
});

export const productPageResponseSchema = z.object({
  items: z.array(productResponseSchema),
  total: z.int().min(0).meta({ example: 1 }),
  limit: z.int().meta({ example: 20 }),
  offset: z.int().meta({ example: 0 }),
});

export const categoryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
});

export const bundleResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  discountPercent: z.int().meta({ example: 10 }),
  price: moneySchema.describe('Calculat din componente, minus reducerea'),
  availableStock: z
    .int()
    .min(0)
    .describe('Cate pachete complete se pot forma din stocul curent')
    .meta({ example: 5 }),
  items: z.array(
    z.object({
      productId: z.uuid(),
      name: z.string(),
      quantity: z.int().meta({ example: 2 }),
      unitPrice: moneySchema,
    }),
  ),
});
