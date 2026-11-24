import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import type { NotificationRecord } from '../../domain/NotificationRecord';
import type {
  ChannelPreferences,
  NotificationHistoryUseCase,
  NotificationPage,
  NotificationPreferencesUseCase,
} from '../../ports/in/NotificationUseCases';
import {
  listNotificationsQuerySchema,
  setPreferencesSchema,
  type notificationPageResponseSchema,
  type notificationResponseSchema,
  type preferencesResponseSchema,
} from './notifications.schemas';

export interface NotificationsRouterDependencies {
  readonly history: NotificationHistoryUseCase;
  readonly preferences: NotificationPreferencesUseCase;
  /** Toate rutele de notificari cer autentificare: fiecare client vede si seteaza doar ale lui. */
  readonly requireAuth: RequestHandler;
}

export function toNotificationResponse(
  record: NotificationRecord,
): z.infer<typeof notificationResponseSchema> {
  return {
    id: record.id,
    channel: record.channel,
    kind: record.kind,
    orderId: record.orderId,
    subject: record.subject,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
  };
}

function toPageResponse(page: NotificationPage): z.infer<typeof notificationPageResponseSchema> {
  return {
    items: page.items.map(toNotificationResponse),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

function toPreferencesResponse(
  preferences: ChannelPreferences,
): z.infer<typeof preferencesResponseSchema> {
  return { channels: [...preferences.channels], isDefault: preferences.isDefault };
}

/** Adaptor inbound REST pentru notificari: istoricul clientului si preferintele lui de canale. */
export function createNotificationsRouter({
  history,
  preferences,
  requireAuth,
}: NotificationsRouterDependencies): Router {
  const router = Router();
  router.use('/notifications', requireAuth);

  router.get('/notifications', async (req, res) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    res.json(toPageResponse(await history.listMine(principalOf(req), query)));
  });

  router.get('/notifications/preferences', async (req, res) => {
    res.json(toPreferencesResponse(await preferences.get(principalOf(req))));
  });

  router.put('/notifications/preferences', async (req, res) => {
    const { channels } = setPreferencesSchema.parse(req.body);
    res.json(toPreferencesResponse(await preferences.set(principalOf(req), channels)));
  });

  return router;
}
