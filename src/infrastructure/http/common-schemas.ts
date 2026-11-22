import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../shared';

/** Scheme Zod folosite de mai multe module: validarea input-ului si sursa documentatiei OpenAPI. */

export const moneySchema = z.object({
  amount: z.int().describe('Suma in cenți (numar intreg)').meta({ example: 7999 }),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const idParamsSchema = z.object({ id: z.uuid() });

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Cod stabil, citibil de masina (ex. NOT_FOUND)'),
    message: z.string(),
    details: z.array(z.unknown()).optional().describe('Doar la VALIDATION_ERROR: problemele Zod'),
  }),
});
