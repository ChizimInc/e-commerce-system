import type { NotificationContent } from '../../domain/NotificationChannel';
import { OutboxChannel, type ChannelDependencies, type RenderedMessage } from './OutboxChannel';

// Pattern: Bridge (Structural) – implementor concret: email (subiect + corp lung, cu formula de adresare)
export class EmailChannel extends OutboxChannel {
  constructor(deps: ChannelDependencies) {
    super('EMAIL', deps);
  }

  protected render({ headline, lines }: NotificationContent): RenderedMessage {
    return {
      subject: headline,
      body: ['Buna ziua,', '', ...lines, '', 'Echipa magazinului'].join('\n'),
    };
  }
}
