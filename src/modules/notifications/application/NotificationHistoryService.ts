import type { Principal } from '../../../shared';
import type {
  ListNotificationsQuery,
  NotificationHistoryUseCase,
  NotificationPage,
} from '../ports/in/NotificationUseCases';
import type { NotificationOutbox } from '../ports/out/NotificationOutbox';

/** Istoricul notificarilor clientului: doar ale lui (identitatea vine din token, nu din cerere). */
export class NotificationHistoryService implements NotificationHistoryUseCase {
  constructor(private readonly outbox: NotificationOutbox) {}

  async listMine(principal: Principal, query: ListNotificationsQuery): Promise<NotificationPage> {
    const { items, total } = await this.outbox.listByRecipient({
      recipientId: principal.userId,
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total, limit: query.limit, offset: query.offset };
  }
}
