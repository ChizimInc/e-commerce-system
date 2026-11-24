import { describe, expect, it } from 'vitest';
import { MOCK_AMOUNTS } from '../../../src/modules/payments/adapters/providers/mock-support';
import {
  PaymentProviderError,
  PaymentRejectedError,
} from '../../../src/modules/payments/domain/errors';
import type { OrderCancelledEvent } from '../../../src/modules/payments/application/RefundOnOrderCancelled';
import { DomainError } from '../../../src/shared';
import { buildPaymentsHarness, owner, START } from '../../helpers/payments-harness';

const cancelled = (orderId: string, wasPaid = true): OrderCancelledEvent => ({
  type: 'OrderCancelled',
  occurredAt: START,
  orderId,
  wasPaid,
});

const DAY = 24 * 60 * 60 * 1000;

/** O comanda platita (ca dupa PayOrder), gata sa fie anulata. */
async function paidOrder(h: ReturnType<typeof buildPaymentsHarness>, n: number, amount = 10_000) {
  const order = h.newOrder(n, amount);
  const payment = await h.payOrder.execute(owner, order.id);
  return { order, payment };
}

describe('RefundOnOrderCancelled (Observer)', () => {
  it('este abonat la OrderCancelled: un eveniment publicat pe magistrala ramburseaza plata si trece comanda in REFUNDED', async () => {
    const h = buildPaymentsHarness();
    const { order } = await paidOrder(h, 1, 12_340);

    await h.events.publish(cancelled(order.id));

    expect(await h.payments.findByOrderId(order.id)).toMatchObject({
      status: 'REFUNDED',
      refundExternalId: expect.stringMatching(/^re_mock_/) as string,
    });
    expect(h.stripe.issuedRefunds()).toHaveLength(1);
    expect(h.stripe.issuedRefunds()[0]?.amount).toBe(12_340);
    expect(h.orders.refunded).toEqual([order.id]);
  });

  it('ignora celelalte evenimente si anularile unei comenzi neplatite (nimic de rambursat)', async () => {
    const h = buildPaymentsHarness();
    const { order } = await paidOrder(h, 1);

    await h.events.publish({ type: 'OrderShipped', occurredAt: START });
    await h.events.publish(cancelled(order.id, false));

    expect(h.stripe.issuedRefunds()).toHaveLength(0);
    expect(h.orders.refunded).toEqual([]);
    expect((await h.payments.findByOrderId(order.id))?.status).toBe('CAPTURED');
  });

  it.each([
    ['PAYPAL', 'PAYPAL'],
    ['CASH_ON_DELIVERY', 'COD'],
  ] as const)(
    '%s: rambursarea trece prin procesorul de rambursari al furnizorului %s',
    async (method, provider) => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 8_000, method);
      const paid = await h.payOrder.execute(owner, order.id);

      await h.events.publish(cancelled(order.id));

      expect(await h.payments.findByOrderId(order.id)).toMatchObject({
        provider,
        status: 'REFUNDED',
      });
      expect(h.orders.refunded).toEqual([order.id]);
      expect(
        h.paypal.issuedRefunds().length +
          (h.courier.refundedMinor(paid.externalId ?? '') > 0 ? 1 : 0),
      ).toBe(1);
    },
  );

  describe('idempotenta (aceeasi anulare procesata de mai multe ori)', () => {
    it('a doua livrare a evenimentului nu ramburseaza din nou', async () => {
      const h = buildPaymentsHarness();
      const { order } = await paidOrder(h, 1);

      await h.events.publish(cancelled(order.id));
      await h.events.publish(cancelled(order.id));

      expect(h.stripe.issuedRefunds()).toHaveLength(1);
    });

    it('livrari simultane ale aceluiasi eveniment: o singura rambursare, fara erori', async () => {
      const h = buildPaymentsHarness();
      const { order } = await paidOrder(h, 1);

      await Promise.all(
        Array.from({ length: 6 }, () => h.refundOnCancelled.handle(cancelled(order.id))),
      );

      expect(h.stripe.issuedRefunds()).toHaveLength(1);
      expect((await h.payments.findByOrderId(order.id))?.status).toBe('REFUNDED');
    });

    it('daca decontarea comenzii a esuat dupa rambursare, a doua livrare o completeaza fara a rambursa iar', async () => {
      const h = buildPaymentsHarness();
      const { order } = await paidOrder(h, 1);
      h.orders.markRefundedError = new DomainError('baza indisponibila', 'DB_DOWN');

      await expect(h.refundOnCancelled.handle(cancelled(order.id))).rejects.toThrow(
        'baza indisponibila',
      );
      expect((await h.payments.findByOrderId(order.id))?.status).toBe('REFUNDED');
      expect(h.orders.refunded).toEqual([]);

      h.orders.markRefundedError = null;
      await h.refundOnCancelled.handle(cancelled(order.id));

      expect(h.orders.refunded).toEqual([order.id]);
      expect(h.stripe.issuedRefunds()).toHaveLength(1);
    });
  });

  describe('cand rambursarea nu reuseste', () => {
    it('furnizorul refuza: plata revine in CAPTURED (se poate relua), comanda nu se marcheaza, eroarea se propaga', async () => {
      const h = buildPaymentsHarness();
      const { order } = await paidOrder(h, 1, MOCK_AMOUNTS.REFUND_FAILURE);

      await expect(h.refundOnCancelled.handle(cancelled(order.id))).rejects.toBeInstanceOf(
        PaymentProviderError,
      );

      expect(await h.payments.findByOrderId(order.id)).toMatchObject({
        status: 'CAPTURED',
        refundExternalId: null,
      });
      expect(h.orders.refunded).toEqual([]);
    });

    it('un esec propagat pe magistrala nu strica publicarea (bus-ul il izoleaza)', async () => {
      const h = buildPaymentsHarness();
      const { order } = await paidOrder(h, 1, MOCK_AMOUNTS.REFUND_FAILURE);

      await expect(h.events.publish(cancelled(order.id))).resolves.toBeUndefined();
    });

    it('PayPal: dupa 180 de zile furnizorul nu mai ramburseaza; plata ramane CAPTURED', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 5_000, 'PAYPAL');
      await h.payOrder.execute(owner, order.id);
      h.advance(181 * DAY);

      await expect(h.refundOnCancelled.handle(cancelled(order.id))).rejects.toBeInstanceOf(
        PaymentRejectedError,
      );

      expect((await h.payments.findByOrderId(order.id))?.status).toBe('CAPTURED');
      expect(h.paypal.issuedRefunds()).toHaveLength(0);
    });

    it('PayPal: in fereastra de 180 de zile ramburseaza', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, 5_000, 'PAYPAL');
      await h.payOrder.execute(owner, order.id);
      h.advance(179 * DAY);

      await h.refundOnCancelled.handle(cancelled(order.id));

      expect((await h.payments.findByOrderId(order.id))?.status).toBe('REFUNDED');
    });
  });

  describe('comenzi fara plata prin acest modul', () => {
    it('o comanda marcata PAID manual (fara inregistrare de plata) se anuleaza fara rambursare si fara eroare', async () => {
      const h = buildPaymentsHarness();
      const order = h.orders.add('00000000-0000-4000-8000-0000000000aa', { state: 'PAID' });

      await expect(h.refundOnCancelled.handle(cancelled(order.id))).resolves.toBeUndefined();

      expect(h.stripe.issuedRefunds()).toHaveLength(0);
      expect(h.orders.refunded).toEqual([]);
    });

    it('o plata care nu e (inca) incasata (ex. FAILED) nu se ramburseaza si comanda nu devine REFUNDED', async () => {
      const h = buildPaymentsHarness();
      const order = h.newOrder(1, MOCK_AMOUNTS.PROVIDER_ERROR);
      await expect(h.payOrder.execute(owner, order.id)).rejects.toThrow();

      await h.refundOnCancelled.handle(cancelled(order.id));

      expect(h.stripe.issuedRefunds()).toHaveLength(0);
      expect(h.orders.refunded).toEqual([]);
    });
  });
});
