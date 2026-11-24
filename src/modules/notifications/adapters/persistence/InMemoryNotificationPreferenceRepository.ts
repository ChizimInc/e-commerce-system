import { normalizeChannels, type ChannelType } from '../../domain/NotificationTypes';
import type { NotificationPreferenceRepository } from '../../ports/out/NotificationPreferenceRepository';

/** Adaptor in-memory pentru `NotificationPreferenceRepository` (copii defensive: apelantul nu poate modifica starea). */
export class InMemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly store = new Map<string, readonly ChannelType[]>();

  find(userId: string): Promise<readonly ChannelType[] | null> {
    const saved = this.store.get(userId);
    return Promise.resolve(saved ? [...saved] : null);
  }

  save(userId: string, channels: readonly ChannelType[]): Promise<void> {
    // Aceeasi garantie ca la PostgreSQL: canalele se intorc in ordinea standard, fara duplicate.
    this.store.set(userId, normalizeChannels(channels));
    return Promise.resolve();
  }
}
