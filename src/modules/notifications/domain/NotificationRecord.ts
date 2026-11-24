import type { ChannelType, NotificationKind } from './NotificationTypes';

/**
 * O notificare "trimisa" (simulat): inregistrarea din outbox, care e si istoricul clientului. Destinatarul e
 * id-ul utilizatorului; textul nu contine adresa sau numele lui.
 */
export interface NotificationRecord {
  readonly id: string;
  readonly recipientId: string;
  readonly channel: ChannelType;
  readonly kind: NotificationKind;
  readonly orderId: string | null;
  /** Subiectul (email) sau titlul (push); `null` la SMS, care nu are subiect. */
  readonly subject: string | null;
  readonly body: string;
  readonly createdAt: Date;
}
