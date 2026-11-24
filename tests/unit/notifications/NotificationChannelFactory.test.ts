import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../../../src/modules/notifications/adapters/channels/EmailChannel';
import {
  EmailChannelFactory,
  PushChannelFactory,
  SmsChannelFactory,
  createChannelFactories,
} from '../../../src/modules/notifications/adapters/channels/channelFactories';
import { PushChannel } from '../../../src/modules/notifications/adapters/channels/PushChannel';
import { SmsChannel } from '../../../src/modules/notifications/adapters/channels/SmsChannel';
import { NotificationChannels } from '../../../src/modules/notifications/application/NotificationChannels';
import type { NotificationChannel } from '../../../src/modules/notifications/domain/NotificationChannel';
import { NotificationChannelFactory } from '../../../src/modules/notifications/domain/NotificationChannelFactory';
import {
  CHANNEL_TYPES,
  type ChannelType,
} from '../../../src/modules/notifications/domain/NotificationTypes';
import { buildNotificationsHarness } from '../../helpers/notifications-harness';

/** Factory Method (C1): creatorul abstract declara `createChannel()`, iar fiecare subclasa alege canalul concret. */
describe('NotificationChannelFactory (Factory Method)', () => {
  const { deps } = buildNotificationsHarness();

  it('fiecare fabrica concreta produce canalul ei si il anunta prin `type`', () => {
    const cases = [
      [new EmailChannelFactory(deps), 'EMAIL', EmailChannel],
      [new SmsChannelFactory(deps), 'SMS', SmsChannel],
      [new PushChannelFactory(deps), 'PUSH', PushChannel],
    ] as const;

    for (const [factory, type, channelClass] of cases) {
      expect(factory).toBeInstanceOf(NotificationChannelFactory);
      expect(factory.type).toBe(type);
      const channel = factory.createChannel();
      expect(channel).toBeInstanceOf(channelClass);
      expect(channel.type).toBe(type);
    }
  });

  it('operatia creatorului (channel()) refuza o fabrica ce produce alt canal decat cel anuntat', () => {
    class LyingFactory extends NotificationChannelFactory {
      readonly type = 'SMS';
      createChannel(): NotificationChannel {
        return new EmailChannel(deps);
      }
    }

    expect(() => new LyingFactory().channel()).toThrowError(
      expect.objectContaining({ code: 'INVALID_CHANNELS' }) as Error,
    );
    expect(() =>
      new NotificationChannels([
        new LyingFactory(),
        new EmailChannelFactory(deps),
        new PushChannelFactory(deps),
      ]).createChannel('SMS'),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CHANNELS' }) as Error);
  });

  it('metoda-fabrica produce un canal nou la fiecare apel (fara stare comuna)', () => {
    const factory = new EmailChannelFactory(deps);
    expect(factory.createChannel()).not.toBe(factory.createChannel());
  });

  it('createChannelFactories ofera cate o fabrica pentru fiecare tip de canal', () => {
    expect(createChannelFactories(deps).map((factory) => factory.type)).toEqual([...CHANNEL_TYPES]);
  });

  describe('NotificationChannels (alegerea la runtime dupa tipul din preferinte)', () => {
    const channels = new NotificationChannels(createChannelFactories(deps));

    it('intoarce, pentru fiecare tip, canalul produs de fabrica lui', () => {
      for (const type of CHANNEL_TYPES) expect(channels.createChannel(type).type).toBe(type);
    });

    it('un tip necunoscut e refuzat', () => {
      expect(() => channels.createChannel('FAX' as ChannelType)).toThrowError(
        expect.objectContaining({ code: 'UNKNOWN_CHANNEL' }) as Error,
      );
    });

    it('un registru incomplet sau cu fabrici duplicate e refuzat la asamblare', () => {
      expect(() => new NotificationChannels([new EmailChannelFactory(deps)])).toThrowError(
        expect.objectContaining({ code: 'INVALID_CHANNELS' }) as Error,
      );
      expect(
        () =>
          new NotificationChannels([
            ...createChannelFactories(deps),
            new EmailChannelFactory(deps),
          ]),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CHANNELS' }) as Error);
    });

    it('o fabrica proprie inlocuieste canalul fara sa se modifice codul client (extensibilitate)', async () => {
      const sent: string[] = [];
      class CustomSmsChannel implements NotificationChannel {
        readonly type = 'SMS';
        deliver() {
          sent.push('custom');
          return Promise.resolve({ id: 'custom' });
        }
      }
      class CustomSmsFactory extends NotificationChannelFactory {
        readonly type = 'SMS';
        createChannel(): NotificationChannel {
          return new CustomSmsChannel();
        }
      }
      const custom = new NotificationChannels([
        new EmailChannelFactory(deps),
        new CustomSmsFactory(),
        new PushChannelFactory(deps),
      ]);

      await custom
        .createChannel('SMS')
        .deliver('u', { kind: 'PROMO', headline: 'h', lines: [], orderId: null });

      expect(sent).toEqual(['custom']);
    });
  });
});
