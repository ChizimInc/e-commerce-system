import { describe, expect, it } from 'vitest';
import {
  EmailChannelFactory,
  PushChannelFactory,
} from '../../../src/modules/notifications/adapters/channels/channelFactories';
import { NotificationChannelFactory } from '../../../src/modules/notifications/domain/NotificationChannelFactory';
import type { NotificationChannel } from '../../../src/modules/notifications/domain/NotificationChannel';
import { Money } from '../../../src/shared';
import {
  buildNotificationsHarness,
  CUSTOMER,
  event,
  ORDER,
  update,
} from '../../helpers/notifications-harness';
import { uuid } from '../../helpers/ids';

/** Un canal SMS care esueaza mereu (de ex. furnizorul SMS e cazut). */
class BrokenSmsFactory extends NotificationChannelFactory {
  readonly type = 'SMS';
  createChannel(): NotificationChannel {
    return {
      type: 'SMS',
      deliver: () => Promise.reject(new Error('furnizor SMS cazut')),
    };
  }
}

describe('NotificationService (canale alese de client)', () => {
  it('fara preferinte salvate, anunta doar pe canalul implicit (EMAIL)', async () => {
    const h = buildNotificationsHarness();

    await h.service.notifyOrderStatus(update());

    expect((await h.sentTo()).map((r) => r.channel)).toEqual(['EMAIL']);
  });

  it('anunta pe fiecare canal ales, cu aceeasi stire formatata diferit', async () => {
    const h = buildNotificationsHarness();
    await h.preferences.save(CUSTOMER, ['SMS', 'PUSH', 'EMAIL']);

    await h.service.notifyOrderStatus(update({ status: 'PAID' }));

    const sent = await h.sentTo();
    expect(sent.map((r) => r.channel).sort()).toEqual(['EMAIL', 'PUSH', 'SMS']);
    for (const record of sent) {
      expect(record).toMatchObject({ recipientId: CUSTOMER, kind: 'ORDER_STATUS', orderId: ORDER });
    }
  });

  it('canalele nealese nu primesc nimic, iar o lista goala inseamna nicio notificare', async () => {
    const h = buildNotificationsHarness();
    await h.preferences.save(CUSTOMER, ['PUSH']);
    await h.service.notifyOrderStatus(update());
    expect((await h.sentTo()).map((r) => r.channel)).toEqual(['PUSH']);

    await h.preferences.save(CUSTOMER, []);
    await h.service.notifyOrderStatus(update({ status: 'SHIPPED' }));
    expect(await h.sentTo()).toHaveLength(1);
  });

  it('preferintele unui client nu influenteaza alt client', async () => {
    const h = buildNotificationsHarness();
    await h.preferences.save(CUSTOMER, []);

    await h.service.notifyOrderStatus(update({ customerId: uuid(902) }));

    expect(await h.sentTo(CUSTOMER)).toHaveLength(0);
    expect((await h.sentTo(uuid(902))).map((r) => r.channel)).toEqual(['EMAIL']);
  });
});

describe('NotificationService: izolarea erorilor', () => {
  it('un canal care esueaza se logheaza si nu opreste celelalte canale', async () => {
    const h = buildNotificationsHarness({
      factories: (deps) => [
        new EmailChannelFactory(deps),
        new BrokenSmsFactory(),
        new PushChannelFactory(deps),
      ],
    });
    await h.preferences.save(CUSTOMER, ['EMAIL', 'SMS', 'PUSH']);

    await expect(h.service.notifyOrderStatus(update())).resolves.toBeUndefined();

    expect((await h.sentTo()).map((r) => r.channel).sort()).toEqual(['EMAIL', 'PUSH']);
    const failures = h.lines.filter((l) => l.level === 'error');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.line).toContain('"channel":"SMS"');
  });

  it('logul de eroare nu contine destinatarul sau textul notificarii (doar canal, comanda, stadiu)', async () => {
    const h = buildNotificationsHarness();
    h.outbox.append = () => Promise.reject(new Error('outbox indisponibil'));

    await h.service.notifyOrderStatus(update());

    const errors = h.lines.filter((l) => l.level === 'error').map((l) => l.line);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(ORDER);
    expect(errors[0]).not.toContain(CUSTOMER);
    expect(errors[0]).not.toMatch(/Buna ziua|Total de plata/);
  });

  it('canalele pleaca in paralel: unul lent nu le intarzie pe celelalte', async () => {
    const h = buildNotificationsHarness();
    await h.preferences.save(CUSTOMER, ['EMAIL', 'SMS']);
    const real = h.outbox.append.bind(h.outbox);
    const started: string[] = [];
    const release: (() => void)[] = [];
    h.outbox.append = (record) => {
      started.push(record.channel);
      // primul apel (EMAIL) asteapta pana e eliberat; SMS trebuie sa porneasca fara sa-l astepte
      if (started.length === 1) {
        return new Promise<void>((resolve) => {
          release.push(() => resolve(real(record)));
        });
      }
      return real(record);
    };

    const done = h.service.notifyOrderStatus(update());
    await new Promise((resolve) => setTimeout(resolve, 0)); // lasa ambele canale sa porneasca
    expect(started).toEqual(['EMAIL', 'SMS']);
    release[0]?.();
    await done;
    expect((await h.sentTo()).map((r) => r.channel).sort()).toEqual(['EMAIL', 'SMS']);
  });

  it('outbox-ul cazut nu face serviciul sa arunce (comanda nu e afectata)', async () => {
    const h = buildNotificationsHarness();
    h.outbox.append = () => Promise.reject(new Error('baza cazuta'));

    await expect(h.service.notifyOrderStatus(update())).resolves.toBeUndefined();
    expect(h.lines.some((l) => l.level === 'error')).toBe(true);
  });

  it('preferinte ilizibile (repository cazut): se logheaza si nu se arunca', async () => {
    const h = buildNotificationsHarness();
    h.preferences.find = () => Promise.reject(new Error('baza cazuta'));

    await expect(h.service.notifyOrderStatus(update())).resolves.toBeUndefined();
    expect(await h.sentTo()).toHaveLength(0);
    expect(h.lines.filter((l) => l.level === 'error')).toHaveLength(1);
  });

  it('logul contine doar identificatori: nici destinatarul, nici textul notificarii, nici adresa', async () => {
    const h = buildNotificationsHarness();
    await h.preferences.save(CUSTOMER, ['EMAIL', 'SMS', 'PUSH']);

    await h.service.notifyOrderStatus(update({ status: 'PLACED', total: Money.of(51_408, 'RON') }));

    const log = h.logText();
    expect(log).toContain('Notificare simulata');
    expect(log).toContain(ORDER);
    expect(log).not.toContain(CUSTOMER);
    expect(log).not.toMatch(/Buna ziua|514\.08|Total de plata|Popescu|Libertatii/);
  });
});

describe('OrderStatusNotifier (Observer pe evenimentele comenzii)', () => {
  it.each([
    ['OrderPlaced', 'Comanda a fost plasata'],
    ['OrderPaid', 'Plata a fost confirmata'],
    ['OrderShipped', 'Comanda a fost expediata'],
    ['OrderDelivered', 'Comanda a fost livrata'],
    ['OrderCancelled', 'Comanda a fost anulata'],
    ['OrderRefunded', 'Banii au fost returnati'],
  ])('%s -> notificarea "%s"', async (type, subject) => {
    const h = buildNotificationsHarness();

    await h.notifier.handle(event(type));

    expect((await h.sentTo()).map((r) => r.subject)).toEqual([subject]);
  });

  it('se aboneaza la cele sase evenimente ale comenzii si la nimic altceva', () => {
    const h = buildNotificationsHarness();
    const subscribed: string[] = [];
    h.notifier.register({
      subscribe: (type: string) => {
        subscribed.push(type);
        return () => undefined;
      },
      publish: () => Promise.resolve(),
    });

    expect(subscribed.sort()).toEqual(
      [
        'OrderCancelled',
        'OrderDelivered',
        'OrderPaid',
        'OrderPlaced',
        'OrderRefunded',
        'OrderShipped',
      ].sort(),
    );
  });

  it('numara bucatile (nu liniile) si preia `wasPaid` doar de la anulare', async () => {
    const h = buildNotificationsHarness();

    await h.notifier.handle(event('OrderPlaced', { items: [{ quantity: 3 }, { quantity: 4 }] }));
    await h.notifier.handle(event('OrderCancelled', { wasPaid: true }));

    const [cancelled, placed] = await h.sentTo();
    expect(placed?.body).toContain('cu 7 bucati');
    expect(cancelled?.body).toContain('ti se va returna');
  });

  it('un eveniment necunoscut e ignorat, iar o eroare interna nu se propaga', async () => {
    const h = buildNotificationsHarness();
    await h.notifier.handle(event('OrderSomethingElse'));
    expect(await h.sentTo()).toHaveLength(0);

    h.service.notifyOrderStatus = () => Promise.reject(new Error('bug neasteptat'));
    await expect(h.notifier.handle(event('OrderPaid'))).resolves.toBeUndefined();
    expect(h.lines.some((l) => l.level === 'error')).toBe(true);
  });
});

describe('NotificationPreferencesService', () => {
  const principal = { userId: CUSTOMER, role: 'CUSTOMER' } as const;

  it('fara preferinte salvate intoarce implicitul, marcat isDefault', async () => {
    const h = buildNotificationsHarness();
    expect(await h.preferenceService.get(principal)).toEqual({
      channels: ['EMAIL'],
      isDefault: true,
    });
  });

  it('salveaza canalele fara duplicate, in ordinea standard, si nu mai e implicit', async () => {
    const h = buildNotificationsHarness();

    const saved = await h.preferenceService.set(principal, ['PUSH', 'EMAIL', 'PUSH']);

    expect(saved).toEqual({ channels: ['EMAIL', 'PUSH'], isDefault: false });
    expect(await h.preferenceService.get(principal)).toEqual(saved);
  });

  it('lista goala e o alegere valida (nicio notificare), nu revenire la implicit', async () => {
    const h = buildNotificationsHarness();
    await h.preferenceService.set(principal, []);

    expect(await h.preferenceService.get(principal)).toEqual({ channels: [], isDefault: false });
    expect(await h.preferenceService.channelsFor(CUSTOMER)).toEqual([]);
  });
});
