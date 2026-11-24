import { describe, expect, it } from 'vitest';
import { EmailChannel } from '../../../src/modules/notifications/adapters/channels/EmailChannel';
import {
  PUSH_BODY_MAX_LENGTH,
  PUSH_TITLE_MAX_LENGTH,
  PushChannel,
} from '../../../src/modules/notifications/adapters/channels/PushChannel';
import {
  SMS_MAX_LENGTH,
  SmsChannel,
} from '../../../src/modules/notifications/adapters/channels/SmsChannel';
import {
  ORDER_STATUS_UPDATES,
  OrderStatusNotification,
  PromoNotification,
  type Notification,
} from '../../../src/modules/notifications/domain/Notification';
import type {
  NotificationChannel,
  NotificationContent,
} from '../../../src/modules/notifications/domain/NotificationChannel';
import { CHANNEL_TYPES } from '../../../src/modules/notifications/domain/NotificationTypes';
import {
  buildNotificationsHarness,
  CUSTOMER,
  ORDER,
  update,
} from '../../helpers/notifications-harness';

/** Un canal minimal, scris in test: dovedeste ca abstractia nu depinde de canalele reale. */
class RecordingChannel implements NotificationChannel {
  readonly type = 'EMAIL';
  readonly delivered: { recipientId: string; content: NotificationContent }[] = [];

  deliver(recipientId: string, content: NotificationContent) {
    this.delivered.push({ recipientId, content });
    return Promise.resolve({ id: 'x' });
  }
}

/**
 * Bridge (S6): doua ierarhii care variaza independent. Tipurile de notificare (OrderStatus, Promo) decid CE se spune,
 * canalele (Email, Sms, Push) decid CUM se formateaza; orice pereche functioneaza fara clase in plus.
 */
describe('Notification × NotificationChannel (Bridge)', () => {
  const build = () => {
    const h = buildNotificationsHarness();
    const channels = {
      EMAIL: new EmailChannel(h.deps),
      SMS: new SmsChannel(h.deps),
      PUSH: new PushChannel(h.deps),
    };
    return { h, channels };
  };

  describe('abstractia (tipul de notificare) nu stie de canal', () => {
    it('OrderStatusNotification trimite continutul prin ORICE canal implementor, cu destinatarul dat', async () => {
      const channel = new RecordingChannel();

      await new OrderStatusNotification(channel, update({ status: 'SHIPPED' })).send(CUSTOMER);

      expect(channel.delivered).toHaveLength(1);
      expect(channel.delivered[0]).toMatchObject({
        recipientId: CUSTOMER,
        content: { kind: 'ORDER_STATUS', orderId: ORDER, headline: 'Comanda a fost expediata' },
      });
    });

    it('PromoNotification foloseste acelasi canal, fara nicio schimbare in canal', async () => {
      const channel = new RecordingChannel();

      await new PromoNotification(channel, { title: 'Reduceri', text: '10% la tot' }).send(
        CUSTOMER,
      );

      expect(channel.delivered[0]?.content).toEqual({
        kind: 'PROMO',
        headline: 'Reduceri',
        lines: ['10% la tot'],
        orderId: null,
      });
    });
  });

  describe('implementorul (canalul) nu stie de tipul de notificare', () => {
    it('fiecare canal formateaza acelasi continut dupa mediul lui', async () => {
      const { h, channels } = build();
      const notification = (channel: NotificationChannel): Notification =>
        new OrderStatusNotification(channel, update({ status: 'PLACED' }));

      for (const type of CHANNEL_TYPES) await notification(channels[type]).send(CUSTOMER);

      const byChannel = Object.fromEntries((await h.sentTo()).map((r) => [r.channel, r]));
      // email: subiect + corp cu formula de adresare
      expect(byChannel['EMAIL']?.subject).toBe('Comanda a fost plasata');
      expect(byChannel['EMAIL']?.body).toBe(
        'Buna ziua,\n\nAm primit comanda #' +
          ORDER.slice(0, 8) +
          ' cu 2 bucati.\nTotal de plata: 514.08 RON.\n\nEchipa magazinului',
      );
      // SMS: fara subiect, un singur text
      expect(byChannel['SMS']?.subject).toBeNull();
      expect(byChannel['SMS']?.body).toBe(
        `Comanda a fost plasata. Am primit comanda #${ORDER.slice(0, 8)} cu 2 bucati.. Total de plata: 514.08 RON.`,
      );
      // push: titlu + prima linie
      expect(byChannel['PUSH']?.subject).toBe('Comanda a fost plasata');
      expect(byChannel['PUSH']?.body).toBe(`Am primit comanda #${ORDER.slice(0, 8)} cu 2 bucati.`);
    });

    it('SMS-ul e taiat la 160 de caractere, push-ul are titlu si text limitate, emailul nu e taiat', async () => {
      const { h, channels } = build();
      const long = 'x'.repeat(400);
      for (const type of CHANNEL_TYPES) {
        await new PromoNotification(channels[type], { title: 'T'.repeat(100), text: long }).send(
          CUSTOMER,
        );
      }

      const byChannel = Object.fromEntries((await h.sentTo()).map((r) => [r.channel, r]));
      expect(byChannel['SMS']?.body).toHaveLength(SMS_MAX_LENGTH);
      expect(byChannel['SMS']?.body.endsWith('...')).toBe(true);
      expect(byChannel['PUSH']?.subject).toHaveLength(PUSH_TITLE_MAX_LENGTH);
      expect(byChannel['PUSH']?.body).toHaveLength(PUSH_BODY_MAX_LENGTH);
      expect(byChannel['EMAIL']?.body).toContain(long);
    });
  });

  describe('toate combinatiile tip × canal functioneaza (fara explozie de clase)', () => {
    it.each(CHANNEL_TYPES)(
      'canalul %s transmite fiecare stadiu al comenzii si promotia',
      async (type) => {
        const { h, channels } = build();

        for (const status of ORDER_STATUS_UPDATES) {
          await new OrderStatusNotification(channels[type], update({ status })).send(CUSTOMER);
        }
        await new PromoNotification(channels[type], { title: 'Oferta', text: 'Vezi oferta' }).send(
          CUSTOMER,
        );

        const sent = await h.sentTo();
        expect(sent).toHaveLength(ORDER_STATUS_UPDATES.length + 1);
        expect(new Set(sent.map((r) => r.channel))).toEqual(new Set([type]));
        expect(sent.filter((r) => r.kind === 'PROMO')).toHaveLength(1);
        for (const record of sent) expect(record.body.length).toBeGreaterThan(0);
      },
    );
  });

  describe('continutul fiecarui stadiu', () => {
    const headline = (status: (typeof ORDER_STATUS_UPDATES)[number], wasPaid = false) =>
      new OrderStatusNotification(new RecordingChannel(), update({ status, wasPaid })).content();

    it('un mesaj distinct pentru fiecare stadiu, cu referinta scurta a comenzii', () => {
      const headlines = ORDER_STATUS_UPDATES.map((status) => headline(status).headline);
      expect(new Set(headlines).size).toBe(ORDER_STATUS_UPDATES.length);
      for (const status of ORDER_STATUS_UPDATES) {
        expect(headline(status).lines.join(' ')).toContain(`#${ORDER.slice(0, 8)}`);
      }
    });

    it('anularea spune daca suma platita se returneaza', () => {
      // formulare conditionata: o comanda marcata PAID manual de ADMIN poate sa nu aiba nicio plata de rambursat
      expect(headline('CANCELLED', true).lines.join(' ')).toMatch(/Daca plata a fost incasata/);
      expect(headline('CANCELLED', false).lines.join(' ')).toMatch(/Nu s-a incasat/);
    });

    it('un stadiu fara plata incasata nu promite returnarea banilor', () => {
      expect(headline('CANCELLED', false).lines.join(' ')).not.toMatch(/ti se va returna/);
    });
  });

  describe('PromoNotification', () => {
    it('refuza titlu sau text gol ori prea lung', () => {
      const channel = new RecordingChannel();
      const promo = (title: string, text: string) => () =>
        new PromoNotification(channel, { title, text });

      expect(promo('  ', 'ok')).toThrowError(
        expect.objectContaining({ code: 'INVALID_PROMO' }) as Error,
      );
      expect(promo('ok', '')).toThrowError(
        expect.objectContaining({ code: 'INVALID_PROMO' }) as Error,
      );
      expect(promo('x'.repeat(101), 'ok')).toThrowError(
        expect.objectContaining({ code: 'INVALID_PROMO' }) as Error,
      );
      expect(promo('ok', 'x'.repeat(501))).toThrowError(
        expect.objectContaining({ code: 'INVALID_PROMO' }) as Error,
      );
      expect(promo('ok', 'x'.repeat(500))).not.toThrow();
    });
  });
});
