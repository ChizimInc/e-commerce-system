import type { ChannelType } from '../../domain/NotificationTypes';

/** Port de iesire pentru preferintele de notificare ale utilizatorilor (canalele alese). */
export interface NotificationPreferenceRepository {
  /** Canalele alese de utilizator (poate fi lista goala = nicio notificare); `null` daca nu si-a ales niciodata preferintele. */
  find(userId: string): Promise<readonly ChannelType[] | null>;
  /** Inlocuieste canalele utilizatorului (upsert). */
  save(userId: string, channels: readonly ChannelType[]): Promise<void>;
}
