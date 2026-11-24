import type { NotificationChannel } from '../../domain/NotificationChannel';
import { NotificationChannelFactory } from '../../domain/NotificationChannelFactory';
import { EmailChannel } from './EmailChannel';
import type { ChannelDependencies } from './OutboxChannel';
import { PushChannel } from './PushChannel';
import { SmsChannel } from './SmsChannel';

// Pattern: Factory Method (Creational) – creator concret: creeaza canalul de email
export class EmailChannelFactory extends NotificationChannelFactory {
  readonly type = 'EMAIL';

  constructor(private readonly deps: ChannelDependencies) {
    super();
  }

  createChannel(): NotificationChannel {
    return new EmailChannel(this.deps);
  }
}

// Pattern: Factory Method (Creational) – creator concret: creeaza canalul SMS
export class SmsChannelFactory extends NotificationChannelFactory {
  readonly type = 'SMS';

  constructor(private readonly deps: ChannelDependencies) {
    super();
  }

  createChannel(): NotificationChannel {
    return new SmsChannel(this.deps);
  }
}

// Pattern: Factory Method (Creational) – creator concret: creeaza canalul push
export class PushChannelFactory extends NotificationChannelFactory {
  readonly type = 'PUSH';

  constructor(private readonly deps: ChannelDependencies) {
    super();
  }

  createChannel(): NotificationChannel {
    return new PushChannel(this.deps);
  }
}

/** Fabricile celor trei canale simulate, toate scriind in acelasi outbox. */
export function createChannelFactories(deps: ChannelDependencies): NotificationChannelFactory[] {
  return [new EmailChannelFactory(deps), new SmsChannelFactory(deps), new PushChannelFactory(deps)];
}
