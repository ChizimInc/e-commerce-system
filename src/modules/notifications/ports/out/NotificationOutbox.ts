import type { NotificationRecord } from '../../domain/NotificationRecord';

export interface NotificationListFilter {
  readonly recipientId: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Port de iesire: outbox-ul in care canalele simulate "trimit" notificarile; el e si istoricul (`notifications_log`).
 * Nicio notificare nu pleaca in afara sistemului.
 */
export interface NotificationOutbox {
  append(record: NotificationRecord): Promise<void>;
  /** Notificarile unui destinatar, cele mai noi primele (ordine stabila pentru paginare), plus totalul. */
  listByRecipient(
    filter: NotificationListFilter,
  ): Promise<{ items: NotificationRecord[]; total: number }>;
}
