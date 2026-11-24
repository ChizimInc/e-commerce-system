import { describe, expect, it } from 'vitest';
import { CashOnDeliveryGateway } from '../../../src/modules/payments/adapters/providers/cod/CashOnDeliveryGateway';
import { CourierCodApi } from '../../../src/modules/payments/adapters/providers/cod/CourierCodApi';
import { MOCK_AMOUNTS } from '../../../src/modules/payments/adapters/providers/mock-support';
import { PayPalGateway } from '../../../src/modules/payments/adapters/providers/paypal/PayPalGateway';
import { PayPalMockClient } from '../../../src/modules/payments/adapters/providers/paypal/PayPalMockClient';
import { PayPalRefundProcessor } from '../../../src/modules/payments/adapters/providers/paypal/PayPalRefundProcessor';
import { StripeGateway } from '../../../src/modules/payments/adapters/providers/stripe/StripeGateway';
import { StripeMockApi } from '../../../src/modules/payments/adapters/providers/stripe/StripeMockApi';
import { GatewayRefundProcessor } from '../../../src/modules/payments/application/GatewayRefundProcessor';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentTimeoutError,
} from '../../../src/modules/payments/domain/errors';
import { Payment } from '../../../src/modules/payments/domain/Payment';
import type { PaymentGateway } from '../../../src/modules/payments/ports/out/PaymentGateway';
import { Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';

const ron = (cents: number) => Money.of(cents, 'RON');

const authorizeRequest = (cents: number, key = 'pay:k1') => ({
  paymentId: uuid(1),
  reference: 'REF-1',
  amount: ron(cents),
  idempotencyKey: key,
});

/** Contractul `PaymentGateway`, rulat pe fiecare adaptor: acelasi cod client, trei API-uri externe diferite. */
function gatewayContract(
  name: string,
  create: () => { gateway: PaymentGateway; refundsDone: () => number; captured: () => number },
  idPrefix: string,
) {
  describe(`${name} (Adapter peste un API extern diferit)`, () => {
    it('autorizare -> captare -> rambursare: portul ascunde diferentele dintre furnizori', async () => {
      const { gateway, captured, refundsDone } = create();

      const authorization = await gateway.authorize(authorizeRequest(12_345));
      expect(authorization.externalId).toMatch(new RegExp(`^${idPrefix}`));
      expect(captured()).toBe(0); // autorizarea doar rezerva suma

      const capture = await gateway.capture({
        externalId: authorization.externalId,
        amount: ron(12_345),
        idempotencyKey: 'pay:k1:capture',
      });
      expect(captured()).toBe(1);

      const refund = await gateway.refund({
        externalId: capture.externalId,
        amount: ron(12_345),
        idempotencyKey: 'refund:p1',
      });
      expect(refund.externalId).not.toBe('');
      expect(refundsDone()).toBe(1);
    });

    it('cardul refuzat devine PaymentDeclinedError', async () => {
      const { gateway } = create();
      await expect(
        gateway.authorize(authorizeRequest(MOCK_AMOUNTS.DECLINE)),
      ).rejects.toBeInstanceOf(PaymentDeclinedError);
    });

    it('eroarea furnizorului devine PaymentProviderError', async () => {
      const { gateway } = create();
      await expect(
        gateway.authorize(authorizeRequest(MOCK_AMOUNTS.PROVIDER_ERROR)),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });

    it('lipsa raspunsului devine PaymentTimeoutError', async () => {
      const { gateway } = create();
      await expect(
        gateway.authorize(authorizeRequest(MOCK_AMOUNTS.TIMEOUT)),
      ).rejects.toBeInstanceOf(PaymentTimeoutError);
    });

    it('rambursarea esuata la furnizor devine PaymentProviderError (dupa o plata reusita)', async () => {
      const { gateway } = create();
      const authorization = await gateway.authorize(authorizeRequest(MOCK_AMOUNTS.REFUND_FAILURE));
      const capture = await gateway.capture({
        externalId: authorization.externalId,
        amount: ron(MOCK_AMOUNTS.REFUND_FAILURE),
        idempotencyKey: 'c',
      });

      await expect(
        gateway.refund({
          externalId: capture.externalId,
          amount: ron(MOCK_AMOUNTS.REFUND_FAILURE),
          idempotencyKey: 'r',
        }),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });

    it('captarea unei tranzactii necunoscute devine PaymentProviderError', async () => {
      const { gateway } = create();
      await expect(
        gateway.capture({ externalId: 'nu-exista', amount: ron(100), idempotencyKey: 'c' }),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });

    it('aceeasi cheie de idempotenta la autorizare => aceeasi tranzactie, fara a doua rezervare', async () => {
      const { gateway } = create();
      const first = await gateway.authorize(authorizeRequest(5_000, 'pay:same'));
      const second = await gateway.authorize(authorizeRequest(5_000, 'pay:same'));
      expect(second.externalId).toBe(first.externalId);
    });

    it('doua captari ale aceleiasi rezervari: a doua e refuzata de furnizor', async () => {
      const { gateway } = create();
      const { externalId } = await gateway.authorize(authorizeRequest(5_000));
      await gateway.capture({ externalId, amount: ron(5_000), idempotencyKey: 'c1' });

      await expect(
        gateway.capture({ externalId, amount: ron(5_000), idempotencyKey: 'c2' }),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });

    it('nu se poate rambursa mai mult decat s-a incasat', async () => {
      const { gateway } = create();
      const { externalId } = await gateway.authorize(authorizeRequest(5_000));
      const capture = await gateway.capture({
        externalId,
        amount: ron(5_000),
        idempotencyKey: 'c',
      });
      await gateway.refund({
        externalId: capture.externalId,
        amount: ron(5_000),
        idempotencyKey: 'r1',
      });

      await expect(
        gateway.refund({
          externalId: capture.externalId,
          amount: ron(5_000),
          idempotencyKey: 'r2',
        }),
      ).rejects.toBeInstanceOf(PaymentProviderError);
    });
  });
}

gatewayContract(
  'StripeGateway',
  () => {
    const api = new StripeMockApi();
    return {
      gateway: new StripeGateway(api),
      captured: () => api.capturedIntents().length,
      refundsDone: () => api.issuedRefunds().length,
    };
  },
  'pi_mock_',
);

gatewayContract(
  'PayPalGateway',
  () => {
    const client = new PayPalMockClient();
    return {
      gateway: new PayPalGateway(client),
      captured: () => client.completedCaptures().length,
      refundsDone: () => client.issuedRefunds().length,
    };
  },
  'PP-AUTH-',
);

gatewayContract(
  'CashOnDeliveryGateway',
  () => {
    const api = new CourierCodApi();
    return {
      gateway: new CashOnDeliveryGateway(api),
      captured: () => api.collectedTickets().length,
      refundsDone: () => (api.collectedTickets().some((t) => api.refundedMinor(t) > 0) ? 1 : 0),
    };
  },
  'COD-T',
);

describe('formatele deosebite ale API-urilor externe (ce traduce fiecare adaptor)', () => {
  it('Stripe: moneda cu litere mici, suma in cenți, metadata cu id-ul platii, captare manuala', async () => {
    const api = new StripeMockApi();
    await new StripeGateway(api).authorize(authorizeRequest(12_345));

    const { externalId } = await new StripeGateway(api).authorize(authorizeRequest(777, 'pay:2'));
    const intent = await api.paymentIntents.capture(externalId);
    expect(intent).toMatchObject({
      amount: 777,
      currency: 'ron',
      description: 'REF-1',
      metadata: { payment_id: uuid(1) },
      status: 'succeeded',
    });
  });

  it.each([
    [12_345, '123.45'],
    [5, '0.05'],
    [100, '1.00'],
    [99, '0.99'],
    [2_147_483_647, '21474836.47'],
  ])('PayPal: %i cenți devin suma zecimala text "%s"', async (cents, text) => {
    const client = new PayPalMockClient();
    const gateway = new PayPalGateway(client);
    const { externalId } = await gateway.authorize(authorizeRequest(cents));

    const capture = await gateway.capture({ externalId, amount: ron(cents), idempotencyKey: 'c' });

    expect(client.completedCaptures()).toEqual([
      {
        id: capture.externalId,
        status: 'COMPLETED',
        amount: { currency_code: 'RON', value: text },
      },
    ]);
  });

  it('PayPal: id-ul de dupa captare este al capturii, diferit de al autorizarii (cu el se ramburseaza)', async () => {
    const gateway = new PayPalGateway(new PayPalMockClient());
    const authorization = await gateway.authorize(authorizeRequest(500));
    const capture = await gateway.capture({
      externalId: authorization.externalId,
      amount: ron(500),
      idempotencyKey: 'c',
    });
    expect(capture.externalId).toMatch(/^PP-CAP-/);
    expect(capture.externalId).not.toBe(authorization.externalId);
  });

  it('ramburs: raspunsurile cu `ok:false` si cod numeric (nu exceptii) sunt traduse; biletul e id-ul extern', async () => {
    const api = new CourierCodApi();
    expect(
      await api.registerCodShipment({
        orderRef: 'X',
        cashDueMinor: MOCK_AMOUNTS.DECLINE,
        isoCurrency: 'RON',
      }),
    ).toMatchObject({
      ok: false,
      errCode: 17,
    });
    expect(
      await api.registerCodShipment({
        orderRef: 'X',
        cashDueMinor: MOCK_AMOUNTS.TIMEOUT,
        isoCurrency: 'RON',
      }),
    ).toMatchObject({
      ok: false,
      errCode: 408,
    });
    const gateway = new CashOnDeliveryGateway(api);
    const { externalId } = await gateway.authorize(authorizeRequest(900));
    expect(
      (await gateway.capture({ externalId, amount: ron(900), idempotencyKey: 'c' })).externalId,
    ).toBe(externalId);
  });

  it('motivul refuzului e un cod stabil al nostru, nu mesajul brut al furnizorului', async () => {
    const reasons = await Promise.all(
      [
        new StripeGateway(new StripeMockApi()),
        new PayPalGateway(new PayPalMockClient()),
        new CashOnDeliveryGateway(new CourierCodApi()),
      ].map((gateway) =>
        gateway
          .authorize(authorizeRequest(MOCK_AMOUNTS.DECLINE))
          .catch((e: unknown) => (e as PaymentDeclinedError).reason),
      ),
    );
    expect(reasons).toEqual(['card_declined', 'instrument_declined', 'cod_rejected']);
  });
});

describe('id-uri unice intre porniri (mock-urile isi pierd starea, platile din baza de date nu)', () => {
  it.each([
    ['Stripe', () => new StripeGateway(new StripeMockApi())],
    ['PayPal', () => new PayPalGateway(new PayPalMockClient())],
    ['ramburs', () => new CashOnDeliveryGateway(new CourierCodApi())],
  ] as const)('%s: o instanta noua nu repeta id-urile uneia vechi', async (_name, create) => {
    const before = await create().authorize(authorizeRequest(100));
    const afterRestart = await create().authorize(authorizeRequest(100));

    expect(afterRestart.externalId).not.toBe(before.externalId);
  });
});

describe('erori care nu vin de la SDK-ul furnizorului', () => {
  it('Stripe: o exceptie oarecare devine PaymentProviderError, cu cauza pastrata', async () => {
    const cause = new TypeError('socket hang up');
    const api = new StripeMockApi();
    api.paymentIntents.create = () => Promise.reject(cause);

    const error = await new StripeGateway(api)
      .authorize(authorizeRequest(100))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentProviderError);
    expect((error as Error).cause).toBe(cause);
  });

  it('PayPal: o exceptie oarecare devine PaymentProviderError, cu cauza pastrata', async () => {
    const cause = new TypeError('socket hang up');
    const client = new PayPalMockClient();
    client.createOrder = () => Promise.reject(cause);

    const error = await new PayPalGateway(client)
      .authorize(authorizeRequest(100))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentProviderError);
    expect((error as Error).cause).toBe(cause);
  });

  it('PayPal: un raspuns de autorizare fara autorizare e refuzat (nu se presupune succesul)', async () => {
    const client = new PayPalMockClient();
    client.authorizeOrder = (orderId) =>
      Promise.resolve({ id: orderId, status: 'COMPLETED', purchase_units: [] });

    await expect(new PayPalGateway(client).authorize(authorizeRequest(100))).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
  });
});

describe('procesoare de rambursare', () => {
  const refunding = (createdAt: Date, status: 'REFUNDING' | 'CAPTURED' = 'REFUNDING') => {
    const captured = Payment.start({
      id: uuid(1),
      orderId: uuid(2),
      provider: 'PAYPAL',
      amount: ron(5_000),
      now: createdAt,
    })
      .authorized('PP-CAP-1', createdAt)
      .captured('PP-CAP-1', createdAt);
    return status === 'REFUNDING' ? captured.startRefund(createdAt) : captured;
  };

  it('GatewayRefundProcessor: cheia de idempotenta a rambursarii e legata de plata', async () => {
    const seen: string[] = [];
    const gateway = {
      refund: (request: { idempotencyKey: string }) => {
        seen.push(request.idempotencyKey);
        return Promise.resolve({ externalId: 're-1' });
      },
    } as unknown as PaymentGateway;

    await new GatewayRefundProcessor(gateway).refund(refunding(new Date()));

    expect(seen).toEqual([`refund:${uuid(1)}`]);
  });

  it('GatewayRefundProcessor: refuza o plata care nu e REFUNDING (nu a fost revendicata)', async () => {
    const processor = new GatewayRefundProcessor(new StripeGateway(new StripeMockApi()));
    await expect(processor.refund(refunding(new Date(), 'CAPTURED'))).rejects.toMatchObject({
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
  });

  describe('PayPalRefundProcessor: fereastra de 180 de zile', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const paidAt = new Date('2026-01-01T00:00:00.000Z');

    const setup = () => {
      const client = new PayPalMockClient();
      const gateway = new PayPalGateway(client);
      return { gateway, client };
    };

    it.each([1, 179, 180])('la %i zile dupa plata ramburseaza', async (days) => {
      const { gateway } = setup();
      const authorization = await gateway.authorize(authorizeRequest(5_000));
      const capture = await gateway.capture({
        externalId: authorization.externalId,
        amount: ron(5_000),
        idempotencyKey: 'c',
      });
      const payment = Payment.start({
        id: uuid(1),
        orderId: uuid(2),
        provider: 'PAYPAL',
        amount: ron(5_000),
        now: paidAt,
      })
        .authorized(authorization.externalId, paidAt)
        .captured(capture.externalId, paidAt)
        .startRefund(paidAt);

      const processor = new PayPalRefundProcessor(
        gateway,
        () => new Date(paidAt.getTime() + days * DAY),
      );

      await expect(processor.refund(payment)).resolves.toMatchObject({
        externalId: expect.stringMatching(/^PP-REF-/) as string,
      });
    });

    it('la 181 de zile refuza, fara sa atinga furnizorul', async () => {
      const { gateway, client } = setup();
      const payment = refunding(paidAt);
      const processor = new PayPalRefundProcessor(
        gateway,
        () => new Date(paidAt.getTime() + 181 * DAY),
      );

      await expect(processor.refund(payment)).rejects.toMatchObject({
        code: 'REFUND_WINDOW_EXPIRED',
      });
      expect(client.issuedRefunds()).toHaveLength(0);
    });
  });
});
