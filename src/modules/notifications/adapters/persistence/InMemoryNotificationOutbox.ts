import { ConflictError } from '../../../../shared';
import type { NotificationRecord } from '../../domain/NotificationRecord';
import type {
  NotificationListFilter,
  NotificationOutbox,
} from '../../ports/out/NotificationOutbox';

/** Adaptor in-memory pentru `NotificationOutbox`; cele mai noi primele = ordinea inserarii inversata. */
export class InMemoryNotificationOutbox implements NotificationOutbox {
  private readonly records: NotificationRecord[] = [];

  append(record: NotificationRecord): Promise<void> {
    if (this.records.some((existing) => existing.id === record.id)) {
      return Promise.reject(new ConflictError('Notificarea exista deja', 'NOTIFICATION_EXISTS'));
    }
    this.records.push(record);
    return Promise.resolve();
  }

  listByRecipient({
    recipientId,
    limit,
    offset,
  }: NotificationListFilter): Promise<{ items: NotificationRecord[]; total: number }> {
    // Ordinea inserarii (nu `createdAt`), ca la PostgreSQL (`seq`): un ceas dat inapoi nu rastoarna istoricul.
    const mine = this.records.filter((record) => record.recipientId === recipientId).reverse();
    return Promise.resolve({ items: mine.slice(offset, offset + limit), total: mine.length });
  }
}
