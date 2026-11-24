import { z } from 'zod';
import { moneySchema } from '../../../../infrastructure/http/common-schemas';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentProvider,
} from '../../domain/PaymentTypes';

// ---- Cereri ----

/** Numele furnizorului in URL-ul webhook-ului (litere mici), tradus in valoarea din domeniu. */
const WEBHOOK_PROVIDER_SLUGS = {
  stripe: 'STRIPE',
  paypal: 'PAYPAL',
  cod: 'COD',
} as const satisfies Record<string, PaymentProvider>;

export const webhookParamsSchema = z.object({
  provider: z.enum(['stripe', 'paypal', 'cod']).transform((slug) => WEBHOOK_PROVIDER_SLUGS[slug]),
});

// ---- Raspunsuri ----

export const paymentResponseSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  provider: z.enum(PAYMENT_PROVIDERS),
  status: z.enum(PAYMENT_STATUSES),
  amount: moneySchema.describe('Suma platita (egala cu totalul comenzii)'),
  externalId: z.string().nullable().describe('Id-ul tranzactiei la furnizor'),
  failureReason: z
    .string()
    .nullable()
    .describe('Doar pentru DECLINED / FAILED: cod scurt (ex. card_declined, provider_timeout)'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const webhookResponseSchema = z.object({
  received: z.literal(true),
  matched: z.boolean().describe('Evenimentul se refera la o plata cunoscuta'),
  paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
});
