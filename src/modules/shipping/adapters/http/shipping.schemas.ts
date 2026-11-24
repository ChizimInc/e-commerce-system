import { z } from 'zod';
import { moneySchema } from '../../../../infrastructure/http/common-schemas';
import { COURIERS, DELIVERY_METHODS, SHIPMENT_STATUSES } from '../../domain/ShippingTypes';

// ---- Raspunsuri ----

export const shipmentResponseSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  courier: z.enum(COURIERS),
  status: z.enum(SHIPMENT_STATUSES),
  cost: moneySchema.describe('Costul livrarii (cel din totalul comenzii)'),
  externalId: z.string().nullable().describe('Id-ul coletului la curier'),
  trackingNumber: z.string().nullable().describe('Numarul de urmarire pentru client'),
  failureReason: z
    .string()
    .nullable()
    .describe(
      'Doar pentru FAILED: cod scurt (ex. address_not_serviceable, courier_error, courier_timeout)',
    ),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const shippingQuoteResponseSchema = z.object({
  itemsValue: moneySchema.describe('Valoarea marfii din cos, inainte de reducere'),
  units: z.int().describe('Numarul de bucati din cos').meta({ example: 2 }),
  options: z.array(
    z.object({
      deliveryMethod: z.enum(DELIVERY_METHODS),
      courier: z.enum(COURIERS).describe('Cine ar duce coletul'),
      cost: moneySchema.describe('Costul livrarii cu aceasta metoda (intra in totalul comenzii)'),
    }),
  ),
});
