import type { Clock, IdGenerator, Logger } from '../../../../shared';
import type {
  DeliveryReceipt,
  NotificationChannel,
  NotificationContent,
} from '../../domain/NotificationChannel';
import type { ChannelType } from '../../domain/NotificationTypes';
import type { NotificationOutbox } from '../../ports/out/NotificationOutbox';

/** Ce au in comun canalele simulate: outbox-ul in care scriu, generatorul de id-uri, ceasul si logul. */
export interface ChannelDependencies {
  readonly outbox: NotificationOutbox;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Textul pe care il trimite un canal, dupa formatarea pe mediul lui. */
export interface RenderedMessage {
  readonly subject: string | null;
  readonly body: string;
}

/** Taie un text la `max` caractere, cu `...` la final cand a fost scurtat. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

/**
 * Baza canalelor simulate: formateaza continutul (`render`, specific mediului), il scrie in outbox si logheaza doar
 * identificatori (id notificare, canal, tip, comanda), fara destinatar si fara text. Nu trimite nimic in afara sistemului.
 */
export abstract class OutboxChannel implements NotificationChannel {
  protected constructor(
    readonly type: ChannelType,
    private readonly deps: ChannelDependencies,
  ) {}

  /** Formatarea pe mediu: ce difera intre email, SMS si push. */
  protected abstract render(content: NotificationContent): RenderedMessage;

  async deliver(recipientId: string, content: NotificationContent): Promise<DeliveryReceipt> {
    const { outbox, ids, clock, logger } = this.deps;
    const { subject, body } = this.render(content);
    const id = ids.next();
    await outbox.append({
      id,
      recipientId,
      channel: this.type,
      kind: content.kind,
      orderId: content.orderId,
      subject,
      body,
      createdAt: clock(),
    });
    logger.info('Notificare simulata', {
      notificationId: id,
      channel: this.type,
      kind: content.kind,
      orderId: content.orderId,
    });
    return { id };
  }
}
