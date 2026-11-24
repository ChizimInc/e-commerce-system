import type { Principal } from '../../../shared';
import { DEFAULT_CHANNELS, normalizeChannels, type ChannelType } from '../domain/NotificationTypes';
import type {
  ChannelPreferences,
  NotificationPreferencesUseCase,
} from '../ports/in/NotificationUseCases';
import type { NotificationPreferenceRepository } from '../ports/out/NotificationPreferenceRepository';

/** Preferintele de notificare: canalele alese de client, cu valori implicite cat timp nu a ales nimic. */
export class NotificationPreferencesService implements NotificationPreferencesUseCase {
  constructor(private readonly preferences: NotificationPreferenceRepository) {}

  async get(principal: Principal): Promise<ChannelPreferences> {
    return this.preferencesOf(principal.userId);
  }

  async set(principal: Principal, channels: readonly ChannelType[]): Promise<ChannelPreferences> {
    const chosen = normalizeChannels(channels);
    await this.preferences.save(principal.userId, chosen);
    return { channels: chosen, isDefault: false };
  }

  /** Canalele pe care trebuie anuntat un utilizator (cele alese de el sau cele implicite). */
  async channelsFor(userId: string): Promise<readonly ChannelType[]> {
    return (await this.preferencesOf(userId)).channels;
  }

  private async preferencesOf(userId: string): Promise<ChannelPreferences> {
    const saved = await this.preferences.find(userId);
    return saved === null
      ? { channels: DEFAULT_CHANNELS, isDefault: true }
      : { channels: saved, isDefault: false };
  }
}
