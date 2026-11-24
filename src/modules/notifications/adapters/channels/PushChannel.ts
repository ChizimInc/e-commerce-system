import type { NotificationContent } from '../../domain/NotificationChannel';
import {
  OutboxChannel,
  truncate,
  type ChannelDependencies,
  type RenderedMessage,
} from './OutboxChannel';

export const PUSH_TITLE_MAX_LENGTH = 50;
export const PUSH_BODY_MAX_LENGTH = 120;

// Pattern: Bridge (Structural) – implementor concret: notificare push (titlu scurt + prima linie, taiata la 120 de caractere)
export class PushChannel extends OutboxChannel {
  constructor(deps: ChannelDependencies) {
    super('PUSH', deps);
  }

  protected render({ headline, lines }: NotificationContent): RenderedMessage {
    return {
      subject: truncate(headline, PUSH_TITLE_MAX_LENGTH),
      body: truncate(lines[0] ?? '', PUSH_BODY_MAX_LENGTH),
    };
  }
}
