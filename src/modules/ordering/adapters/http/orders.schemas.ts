import { z } from 'zod';
import { moneySchema } from '../../../../infrastructure/http/common-schemas';
import { DELIVERY_METHODS, ORDER_STATUSES, PAYMENT_METHODS } from '../../domain/OrderTypes';

// ---- Cereri ----

const addressSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(100).meta({ example: 'Ana Popescu' }),
    street: z.string().trim().min(1).max(200).meta({ example: 'Str. Libertatii 10' }),
    city: z.string().trim().min(1).max(100).meta({ example: 'Chisinau' }),
    postalCode: z.string().trim().min(1).max(20).meta({ example: 'MD-2001' }),
    country: z.string().trim().length(2).describe('Cod ISO 3166-1 alpha-2').meta({ example: 'MD' }),
  })
  .strict();

export const placeOrderSchema = z
  .object({
    address: addressSchema,
    deliveryMethod: z.enum(DELIVERY_METHODS),
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .strict();

export const changeOrderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES) }).strict();

export const listOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---- Raspunsuri ----

export const orderResponseSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  items: z.array(
    z.object({
      itemId: z.uuid(),
      name: z.string(),
      unitPrice: moneySchema.describe('Pretul din momentul comenzii'),
      quantity: z.int().meta({ example: 2 }),
      lineTotal: moneySchema,
    }),
  ),
  subtotal: moneySchema.describe('Suma liniilor, inainte de reducere si TVA'),
  discount: moneySchema.describe('Reducerea aplicata pe subtotal'),
  vat: moneySchema.describe('TVA calculat pe subtotalul redus'),
  total: moneySchema.describe('De plata: subtotal - reducere + TVA'),
  address: addressSchema,
  deliveryMethod: z.enum(DELIVERY_METHODS),
  paymentMethod: z.enum(PAYMENT_METHODS),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});

export const orderPageResponseSchema = z.object({
  items: z.array(orderResponseSchema),
  total: z.int().describe('Numarul total de comenzi ale clientului').meta({ example: 1 }),
  limit: z.int().meta({ example: 20 }),
  offset: z.int().meta({ example: 0 }),
});
