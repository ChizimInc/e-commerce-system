import { z } from 'zod';
import { CHANNEL_TYPES, NOTIFICATION_KINDS } from '../../domain/NotificationTypes';

// ---- Cereri ----

export const setPreferencesSchema = z
  .object({
    channels: z
      .array(z.enum(CHANNEL_TYPES))
      .max(CHANNEL_TYPES.length)
      .refine((channels) => new Set(channels).size === channels.length, 'canalele nu se pot repeta')
      .describe('Canalele pe care vrei notificari (fara duplicate; lista goala = nicio notificare)')
      .meta({ example: ['EMAIL', 'PUSH'] }),
  })
  .strict();

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---- Raspunsuri ----

export const preferencesResponseSchema = z.object({
  channels: z.array(z.enum(CHANNEL_TYPES)),
  isDefault: z
    .boolean()
    .describe('true cat timp nu ti-ai ales niciodata canalele (se foloseste implicitul: EMAIL)'),
});

export const notificationResponseSchema = z.object({
  id: z.uuid(),
  channel: z.enum(CHANNEL_TYPES),
  kind: z.enum(NOTIFICATION_KINDS),
  orderId: z.uuid().nullable().describe('Comanda la care se refera, daca exista'),
  subject: z.string().nullable().describe('Subiect (email) sau titlu (push); null la SMS'),
  body: z.string(),
  createdAt: z.iso.datetime(),
});

export const notificationPageResponseSchema = z.object({
  items: z.array(notificationResponseSchema),
  total: z.int().describe('Numarul total de notificari ale clientului').meta({ example: 3 }),
  limit: z.int().meta({ example: 20 }),
  offset: z.int().meta({ example: 0 }),
});
