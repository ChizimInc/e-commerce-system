import { DomainError, type Money } from '../../../shared';
import type {
  DeliveryReceipt,
  NotificationChannel,
  NotificationContent,
} from './NotificationChannel';

// Pattern: Bridge (Structural) – abstractia: tipul de notificare (ce se spune) tine o referinta la un `NotificationChannel` (unde se trimite); cele doua ierarhii variaza independent
export abstract class Notification {
  protected constructor(protected readonly channel: NotificationChannel) {}

  /** Ce se spune: continutul, fara sa stie pe ce canal pleaca. */
  abstract content(): NotificationContent;

  /** Trimite notificarea pe canalul primit; formatarea pe mediu (email / SMS / push) o face canalul. */
  send(recipientId: string): Promise<DeliveryReceipt> {
    return this.channel.deliver(recipientId, this.content());
  }
}

/** Stadiile unei comenzi despre care se anunta clientul. */
export const ORDER_STATUS_UPDATES = [
  'PLACED',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatusUpdateKind = (typeof ORDER_STATUS_UPDATES)[number];

/** Ce stie notificarea despre schimbarea de stare a unei comenzi (nu adresa, nu numele). */
export interface OrderStatusUpdate {
  readonly orderId: string;
  readonly customerId: string;
  readonly status: OrderStatusUpdateKind;
  readonly total: Money;
  /** Numarul de bucati comandate. */
  readonly itemCount: number;
  /** Doar pentru CANCELLED: comanda fusese platita (suma se returneaza). */
  readonly wasPaid: boolean;
}

/** Referinta scurta, citibila, a unei comenzi (primele 8 caractere ale id-ului). */
const shortId = (orderId: string): string => `#${orderId.slice(0, 8)}`;

// Pattern: Bridge (Structural) – abstractie rafinata: anunta clientul ca s-a schimbat starea comenzii lui
export class OrderStatusNotification extends Notification {
  constructor(
    channel: NotificationChannel,
    private readonly update: OrderStatusUpdate,
  ) {
    super(channel);
  }

  content(): NotificationContent {
    const { orderId, status, total, itemCount, wasPaid } = this.update;
    const ref = shortId(orderId);
    const base = { kind: 'ORDER_STATUS', orderId } as const;
    switch (status) {
      case 'PLACED':
        return {
          ...base,
          headline: 'Comanda a fost plasata',
          lines: [
            `Am primit comanda ${ref} cu ${itemCount} bucati.`,
            `Total de plata: ${total.toString()}.`,
          ],
        };
      case 'PAID':
        return {
          ...base,
          headline: 'Plata a fost confirmata',
          lines: [`Am incasat ${total.toString()} pentru comanda ${ref}.`],
        };
      case 'SHIPPED':
        return {
          ...base,
          headline: 'Comanda a fost expediata',
          lines: [`Comanda ${ref} a fost predata curierului.`],
        };
      case 'DELIVERED':
        return {
          ...base,
          headline: 'Comanda a fost livrata',
          lines: [`Comanda ${ref} a ajuns la destinatie. Multumim!`],
        };
      case 'CANCELLED':
        return {
          ...base,
          headline: 'Comanda a fost anulata',
          lines: [
            `Comanda ${ref} a fost anulata.`,
            wasPaid
              ? 'Daca plata a fost incasata, suma ti se va returna.'
              : 'Nu s-a incasat nicio suma.',
          ],
        };
      case 'REFUNDED':
        return {
          ...base,
          headline: 'Banii au fost returnati',
          lines: [`Am returnat ${total.toString()} pentru comanda ${ref}.`],
        };
    }
  }
}

export interface PromoDetails {
  readonly title: string;
  readonly text: string;
}

// Pattern: Bridge (Structural) – a doua abstractie rafinata: mesaj promotional, trimis pe aceleasi canale fara nicio clasa in plus per canal
export class PromoNotification extends Notification {
  constructor(
    channel: NotificationChannel,
    private readonly promo: PromoDetails,
  ) {
    super(channel);
    const title = promo.title.trim();
    const text = promo.text.trim();
    if (title.length === 0 || title.length > 100) {
      throw new DomainError('Titlul promotiei trebuie sa aiba 1-100 de caractere', 'INVALID_PROMO');
    }
    if (text.length === 0 || text.length > 500) {
      throw new DomainError('Textul promotiei trebuie sa aiba 1-500 de caractere', 'INVALID_PROMO');
    }
  }

  content(): NotificationContent {
    return {
      kind: 'PROMO',
      headline: this.promo.title.trim(),
      lines: [this.promo.text.trim()],
      orderId: null,
    };
  }
}
