import { createChannelFactories } from '../../src/modules/notifications/adapters/channels/channelFactories';
import { InMemoryNotificationOutbox } from '../../src/modules/notifications/adapters/persistence/InMemoryNotificationOutbox';
import { InMemoryNotificationPreferenceRepository } from '../../src/modules/notifications/adapters/persistence/InMemoryNotificationPreferenceRepository';
import { NotificationChannels } from '../../src/modules/notifications/application/NotificationChannels';
import { NotificationPreferencesService } from '../../src/modules/notifications/application/NotificationPreferencesService';
import { NotificationService } from '../../src/modules/notifications/application/NotificationService';
import {
  OrderStatusNotifier,
  type OrderLifecycleEvent,
} from '../../src/modules/notifications/application/OrderStatusNotifier';
import type { OrderStatusUpdate } from '../../src/modules/notifications/domain/Notification';
import type { NotificationChannelFactory } from '../../src/modules/notifications/domain/NotificationChannelFactory';
import { ConsoleLogger, Money, type LogLevel } from '../../src/shared';
import { SequentialIdGenerator, uuid } from './ids';

export const NOW = new Date('2026-06-01T10:00:00.000Z');
export const CUSTOMER = uuid(901);
export const ORDER = uuid(500);

/** Logger care pastreaza liniile scrise, ca testele sa verifice ce ajunge in log. */
export function capturingLogger() {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = new ConsoleLogger('debug', {}, (level, line) => {
    lines.push({ level, line });
  });
  return { logger, lines, text: () => lines.map((l) => l.line).join('\n') };
}

export const update = (overrides: Partial<OrderStatusUpdate> = {}): OrderStatusUpdate => ({
  orderId: ORDER,
  customerId: CUSTOMER,
  status: 'PAID',
  total: Money.of(51_408, 'RON'),
  itemCount: 2,
  wasPaid: false,
  ...overrides,
});

export const event = (
  type: string,
  overrides: Partial<OrderLifecycleEvent> = {},
): OrderLifecycleEvent => ({
  type,
  occurredAt: NOW,
  orderId: ORDER,
  customerId: CUSTOMER,
  total: Money.of(51_408, 'RON'),
  items: [{ quantity: 1 }, { quantity: 2 }],
  ...overrides,
});

/** Modulul `notifications` asamblat pe adaptoare in-memory, cu canalele simulate reale si un logger capturat. */
export function buildNotificationsHarness(
  options: {
    /** Inlocuieste fabricile implicite (ex. cu una care esueaza). */
    factories?: (
      deps: Parameters<typeof createChannelFactories>[0],
    ) => NotificationChannelFactory[];
  } = {},
) {
  const outbox = new InMemoryNotificationOutbox();
  const preferences = new InMemoryNotificationPreferenceRepository();
  const { logger, lines, text } = capturingLogger();
  const deps = { outbox, ids: new SequentialIdGenerator(9000), clock: () => NOW, logger };
  const channels = new NotificationChannels(
    options.factories?.(deps) ?? createChannelFactories(deps),
  );
  const preferenceService = new NotificationPreferencesService(preferences);
  const service = new NotificationService(channels, preferenceService, logger);
  const notifier = new OrderStatusNotifier(service, logger);

  const sentTo = async (recipientId = CUSTOMER) =>
    (await outbox.listByRecipient({ recipientId, limit: 100, offset: 0 })).items;

  return {
    outbox,
    preferences,
    preferenceService,
    channels,
    service,
    notifier,
    logger,
    lines,
    logText: text,
    deps,
    sentTo,
  };
}
