import type { Principal } from '../../../../shared';
import type { NotificationRecord } from '../../domain/NotificationRecord';
import type { ChannelType } from '../../domain/NotificationTypes';

export interface ListNotificationsQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface NotificationPage {
  readonly items: NotificationRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Port de intrare: istoricul notificarilor clientului (doar ale lui). */
export interface NotificationHistoryUseCase {
  /** Notificarile apelantului, cele mai noi primele. */
  listMine(principal: Principal, query: ListNotificationsQuery): Promise<NotificationPage>;
}

export interface ChannelPreferences {
  readonly channels: readonly ChannelType[];
  /** `true` cat timp utilizatorul nu si-a ales niciodata preferintele (se folosesc canalele implicite). */
  readonly isDefault: boolean;
}

/** Port de intrare: preferintele de notificare ale clientului. */
export interface NotificationPreferencesUseCase {
  get(principal: Principal): Promise<ChannelPreferences>;
  /** Inlocuieste canalele (fara duplicate; lista goala = nicio notificare). */
  set(principal: Principal, channels: readonly ChannelType[]): Promise<ChannelPreferences>;
}
