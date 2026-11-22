import { z } from 'zod';
import { moneySchema } from '../../../../infrastructure/http/common-schemas';
import { MAX_LINE_QUANTITY } from '../../domain/Cart';

// ---- Cereri ----

const quantitySchema = z.number().int().min(1).max(MAX_LINE_QUANTITY);

export const addCartItemSchema = z
  .object({
    itemId: z.uuid().describe('Id-ul unui produs sau al unui pachet din catalog'),
    quantity: quantitySchema.default(1),
  })
  .strict();

export const updateCartItemSchema = z.object({ quantity: quantitySchema }).strict();

export const cartItemParamsSchema = z.object({ itemId: z.uuid() });

// ---- Raspunsuri ----

export const cartResponseSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      name: z.string(),
      unitPrice: moneySchema,
      quantity: z.int().meta({ example: 2 }),
      lineTotal: moneySchema,
      availableStock: z.int().describe('Stocul curent din catalog').meta({ example: 10 }),
      inStock: z.boolean().describe('false daca stocul a scazut sub cantitatea din cos'),
    }),
  ),
  itemCount: z.int().describe('Numarul total de bucati').meta({ example: 2 }),
  total: moneySchema,
});
