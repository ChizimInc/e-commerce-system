import type { NotificationContent } from '../../domain/NotificationChannel';
import {
  OutboxChannel,
  truncate,
  type ChannelDependencies,
  type RenderedMessage,
} from './OutboxChannel';

/** Un SMS are cel mult 160 de caractere. */
export const SMS_MAX_LENGTH = 160;

// Pattern: Bridge (Structural) – implementor concret: SMS (fara subiect, un singur text de cel mult 160 de caractere)
export class SmsChannel extends OutboxChannel {
  constructor(deps: ChannelDependencies) {
    super('SMS', deps);
  }

  protected render({ headline, lines }: NotificationContent): RenderedMessage {
    return { subject: null, body: truncate([headline, ...lines].join('. '), SMS_MAX_LENGTH) };
  }
}
