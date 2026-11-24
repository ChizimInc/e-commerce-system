import { describe, expect, it } from 'vitest';
import { Payment } from '../../../src/modules/payments/domain/Payment';
import {
  PAYMENT_STATUSES,
  type PaymentStatus,
} from '../../../src/modules/payments/domain/PaymentTypes';
import { Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';

const T0 = new Date('2026-06-01T10:00:00.000Z');
const T1 = new Date('2026-06-01T10:00:05.000Z');

const start = (amount = 12_345) =>
  Payment.start({
    id: uuid(1),
    orderId: uuid(2),
    provider: 'STRIPE',
    amount: Money.of(amount, 'RON'),
    now: T0,
  });

/** Calea (din PENDING) prin care se ajunge in fiecare stare, folosind doar API-ul public al platii. */
const PATH: Record<PaymentStatus, () => Payment> = {
  PENDING: () => start(),
  AUTHORIZED: () => start().authorized('ext-1', T1),
  CAPTURED: () => start().authorized('ext-1', T1).captured('ext-1', T1),
  REFUNDING: () => start().authorized('ext-1', T1).captured('ext-1', T1).startRefund(T1),
  REFUNDED: () =>
    start().authorized('ext-1', T1).captured('ext-1', T1).startRefund(T1).refunded('re-1', T1),
  DECLINED: () => start().declined('card_declined', T1),
  FAILED: () => start().failed('provider_error', T1),
};

/** Tranzitia (nume, aplicare) -> starile-sursa din care e valida. */
const ACTIONS: Record<string, { run: (p: Payment) => Payment; from: PaymentStatus[] }> = {
  authorized: { run: (p) => p.authorized('ext-2', T1), from: ['PENDING'] },
  captured: { run: (p) => p.captured('ext-2', T1), from: ['AUTHORIZED'] },
  declined: { run: (p) => p.declined('card_declined', T1), from: ['PENDING'] },
  failed: { run: (p) => p.failed('provider_error', T1), from: ['PENDING', 'AUTHORIZED'] },
  retry: { run: (p) => p.retry(T1), from: ['DECLINED', 'FAILED'] },
  startRefund: { run: (p) => p.startRefund(T1), from: ['CAPTURED'] },
  refunded: { run: (p) => p.refunded('re-2', T1), from: ['REFUNDING'] },
  rollbackRefund: { run: (p) => p.rollbackRefund(T1), from: ['REFUNDING'] },
};

describe('Payment (agregat)', () => {
  describe('creare', () => {
    it('porneste in PENDING, fara id extern, cu cheia de idempotenta derivata din comanda', () => {
      const payment = start();
      expect(payment).toMatchObject({
        status: 'PENDING',
        externalId: null,
        refundExternalId: null,
        failureReason: null,
        idempotencyKey: `pay:${uuid(2)}`,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(payment.amount.toJSON()).toEqual({ amount: 12_345, currency: 'RON' });
    });

    it('cheia de idempotenta e aceeasi pentru aceeasi comanda si diferita intre comenzi', () => {
      expect(Payment.idempotencyKeyFor(uuid(2))).toBe(Payment.idempotencyKeyFor(uuid(2)));
      expect(Payment.idempotencyKeyFor(uuid(2))).not.toBe(Payment.idempotencyKeyFor(uuid(3)));
    });

    it.each([0, -100])('refuza o suma de %i (suma trebuie sa fie pozitiva)', (amount) => {
      expect(() => start(amount)).toThrowError(/pozitiva/);
    });
  });

  describe('matricea tranzitiilor (fiecare actiune din fiecare stare)', () => {
    const cases = Object.entries(ACTIONS).flatMap(([name, { run, from }]) =>
      PAYMENT_STATUSES.map((status) => ({ name, run, status, valid: from.includes(status) })),
    );

    it.each(cases)('$name din $status: valida=$valid', ({ run, status, valid }) => {
      const payment = PATH[status]();
      if (valid) {
        expect(() => run(payment)).not.toThrow();
      } else {
        expect(() => run(payment)).toThrowError(
          expect.objectContaining({ code: 'INVALID_PAYMENT_TRANSITION' }) as Error,
        );
      }
    });
  });

  describe('efectele tranzitiilor', () => {
    it('este imutabila: o tranzitie intoarce o plata noua, cea veche ramane neschimbata', () => {
      const pending = start();
      const authorized = pending.authorized('ext-1', T1);
      expect(pending.status).toBe('PENDING');
      expect(pending.externalId).toBeNull();
      expect(authorized.status).toBe('AUTHORIZED');
      expect(authorized.updatedAt).toEqual(T1);
      expect(authorized.createdAt).toEqual(T0);
    });

    it('captarea poate inlocui id-ul extern (PayPal: id-ul capturii e altul decat al autorizarii)', () => {
      expect(PATH.AUTHORIZED().captured('capture-9', T1).externalId).toBe('capture-9');
    });

    it('un esec dupa autorizare pastreaza id-ul extern (rezervarea trebuie sa poata fi gasita la furnizor)', () => {
      const failed = PATH.AUTHORIZED().failed('provider_timeout', T1);
      expect(failed).toMatchObject({
        status: 'FAILED',
        externalId: 'ext-1',
        failureReason: 'provider_timeout',
      });
    });

    it('retry sterge urmele incercarii anterioare', () => {
      const retried = PATH.FAILED().retry(T1);
      expect(retried).toMatchObject({ status: 'PENDING', externalId: null, failureReason: null });
    });

    it('rambursarea esuata readuce plata in CAPTURED, fara sa piarda id-ul extern', () => {
      expect(PATH.REFUNDING().rollbackRefund(T1)).toMatchObject({
        status: 'CAPTURED',
        externalId: 'ext-1',
      });
    });

    it('rambursarea incheiata pastreaza id-ul rambursarii', () => {
      expect(PATH.REFUNDED()).toMatchObject({ status: 'REFUNDED', refundExternalId: 're-1' });
    });
  });

  describe('restore (date salvate)', () => {
    const props = (overrides: Partial<Parameters<typeof Payment.restore>[0]>) => ({
      ...start(),
      amount: Money.of(100, 'RON'),
      ...overrides,
    });

    it.each(['AUTHORIZED', 'CAPTURED', 'REFUNDING', 'REFUNDED'] as const)(
      'refuza %s fara id extern',
      (status) => {
        expect(() =>
          Payment.restore(props({ status, externalId: null, refundExternalId: 're-1' })),
        ).toThrowError(/id la furnizor/);
      },
    );

    it('refuza REFUNDED fara id-ul rambursarii', () => {
      expect(() =>
        Payment.restore(props({ status: 'REFUNDED', externalId: 'x', refundExternalId: null })),
      ).toThrowError(/id-ul rambursarii/);
    });
  });
});
