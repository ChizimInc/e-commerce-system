import { DomainError } from '../../../shared';
import type { NotificationChannel } from '../domain/NotificationChannel';
import type { NotificationChannelFactory } from '../domain/NotificationChannelFactory';
import { CHANNEL_TYPES, type ChannelType } from '../domain/NotificationTypes';

/**
 * Alege fabrica potrivita dupa tipul de canal (la runtime, din preferintele clientului) si ii cere canalul prin
 * `channel()` (operatia creatorului, care apeleaza metoda-fabrica `createChannel()`). Un canal nou = o fabrica noua (si o valoare in `CHANNEL_TYPES`), fara sa se modifice serviciul de notificare.
 */
export class NotificationChannels {
  private readonly byType: ReadonlyMap<ChannelType, NotificationChannelFactory>;

  constructor(factories: readonly NotificationChannelFactory[]) {
    const byType = new Map<ChannelType, NotificationChannelFactory>();
    for (const factory of factories) {
      if (byType.has(factory.type)) {
        throw new DomainError(
          `Fabrica duplicata pentru canalul ${factory.type}`,
          'INVALID_CHANNELS',
        );
      }
      byType.set(factory.type, factory);
    }
    // Un canal fara fabrica ar esua abia la prima notificare: refuzam asamblarea.
    const missing = CHANNEL_TYPES.filter((type) => !byType.has(type));
    if (missing.length > 0) {
      throw new DomainError(`Lipsesc fabrici pentru: ${missing.join(', ')}`, 'INVALID_CHANNELS');
    }
    this.byType = byType;
  }

  createChannel(type: ChannelType): NotificationChannel {
    const factory = this.byType.get(type);
    if (!factory) throw new DomainError(`Canal necunoscut: ${type}`, 'UNKNOWN_CHANNEL');
    return factory.channel();
  }
}
