import type { ChannelType, NotificationKind } from './NotificationTypes';

/**
 * Continutul unei notificari, independent de canal: abstractia (tipul de notificare) il produce, iar fiecare canal
 * il formateaza dupa propriul mediu (email: subiect + corp; SMS: text scurt; push: titlu + text). Fara date personale:
 * nici adresa, nici numele destinatarului.
 */
export interface NotificationContent {
  readonly kind: NotificationKind;
  readonly headline: string;
  readonly lines: readonly string[];
  /** Comanda la care se refera notificarea, daca exista. */
  readonly orderId: string | null;
}

export interface DeliveryReceipt {
  readonly id: string;
}

// Pattern: Bridge (Structural) – implementorul: interfata pe care o implementeaza canalele (Email/Sms/Push); abstractia `Notification` o foloseste fara sa-i cunoasca clasele concrete
/**
 * Un canal de notificare. Aici toate sunt simulate: scriu in outbox si in log, fara trimitere reala. Destinatarul este
 * id-ul utilizatorului (nu un email sau un numar de telefon), deci nu exista date de contact de scurs.
 */
export interface NotificationChannel {
  readonly type: ChannelType;
  deliver(recipientId: string, content: NotificationContent): Promise<DeliveryReceipt>;
}
