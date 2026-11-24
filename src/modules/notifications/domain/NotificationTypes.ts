/** Canalele pe care se pot trimite notificari (toate simulate: scriu intr-un outbox, nu trimit nimic real). */
export const CHANNEL_TYPES = ['EMAIL', 'SMS', 'PUSH'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Tipurile de notificare (abstractiile din Bridge): starea unei comenzi sau o promotie. */
export const NOTIFICATION_KINDS = ['ORDER_STATUS', 'PROMO'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Canalele unui client care nu si-a ales niciodata preferintele: doar email. */
export const DEFAULT_CHANNELS: readonly ChannelType[] = ['EMAIL'];

/** Ordonare stabila si fara duplicate, in ordinea din `CHANNEL_TYPES` (preferintele sunt o multime). */
export function normalizeChannels(channels: readonly ChannelType[]): ChannelType[] {
  return CHANNEL_TYPES.filter((type) => channels.includes(type));
}
