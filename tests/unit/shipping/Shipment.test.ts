import { describe, expect, it } from 'vitest';
import { Shipment } from '../../../src/modules/shipping/domain/Shipment';
import { Money } from '../../../src/shared';
import { uuid } from '../../helpers/ids';

const T0 = new Date('2026-06-01T10:00:00.000Z');
const T1 = new Date('2026-06-01T11:00:00.000Z');

const start = () =>
  Shipment.start({
    id: uuid(1),
    orderId: uuid(2),
    courier: 'FAST_COURIER',
    cost: Money.of(3_000, 'RON'),
    now: T0,
  });
const created = () => start().created('FC-1', 'TRK-1', T1);

describe('Shipment (ciclul de viata al unei livrari)', () => {
  it('porneste PENDING, fara id la curier si fara numar de urmarire', () => {
    const shipment = start();
    expect(shipment.status).toBe('PENDING');
    expect([shipment.externalId, shipment.trackingNumber, shipment.failureReason]).toEqual([
      null,
      null,
      null,
    ]);
    expect(shipment.cost.toJSON()).toEqual({ amount: 3_000, currency: 'RON' });
  });

  it('PENDING -> CREATED pastreaza id-ul si numarul de urmarire; originalul ramane neschimbat (imutabil)', () => {
    const pending = start();
    const shipment = pending.created('FC-1', 'TRK-1', T1);

    expect([shipment.status, shipment.externalId, shipment.trackingNumber]).toEqual([
      'CREATED',
      'FC-1',
      'TRK-1',
    ]);
    expect(shipment.updatedAt).toEqual(T1);
    expect(shipment.createdAt).toEqual(T0);
    expect(pending.status).toBe('PENDING');
  });

  it('PENDING -> FAILED pastreaza doar codul esecului, iar FAILED se poate relua (PENDING, fara urme)', () => {
    const failed = start().failed('address_not_serviceable', T1);
    expect([failed.status, failed.failureReason, failed.externalId]).toEqual([
      'FAILED',
      'address_not_serviceable',
      null,
    ]);

    const retried = failed.retry(T1);
    expect([retried.status, retried.failureReason]).toEqual(['PENDING', null]);
  });

  it('restart() reinnoieste momentul revendicarii unei livrari PENDING; din alta stare e refuzat', () => {
    const restarted = start().restart(T1);
    expect([restarted.status, restarted.updatedAt]).toEqual(['PENDING', T1]);
    expect(() => created().restart(T1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHIPMENT_TRANSITION' }) as Error,
    );
  });

  it('urmarirea avanseaza doar inainte: CREATED -> IN_TRANSIT -> DELIVERED', () => {
    const inTransit = created().tracked('IN_TRANSIT', T1);
    expect(inTransit.status).toBe('IN_TRANSIT');
    expect(inTransit.tracked('DELIVERED', T1).status).toBe('DELIVERED');
    expect(created().tracked('RETURNED', T1).status).toBe('RETURNED');
  });

  it('o stare identica sau mai veche (raspuns intarziat) lasa livrarea neschimbata', () => {
    const inTransit = created().tracked('IN_TRANSIT', T1);
    expect(inTransit.tracked('IN_TRANSIT', T1)).toBe(inTransit);
    expect(inTransit.tracked('CREATED', T1)).toBe(inTransit);
    const delivered = inTransit.tracked('DELIVERED', T1);
    expect(delivered.tracked('IN_TRANSIT', T1)).toBe(delivered);
    // DELIVERED si RETURNED sunt finale: una nu o inlocuieste pe cealalta
    expect(delivered.tracked('RETURNED', T1)).toBe(delivered);
  });

  it.each(['PENDING', 'FAILED'] as const)(
    'o livrare %s nu poate fi urmarita la curier',
    (status) => {
      const shipment = status === 'PENDING' ? start() : start().failed('courier_error', T1);
      expect(() => shipment.tracked('IN_TRANSIT', T1)).toThrowError(
        expect.objectContaining({ code: 'INVALID_SHIPMENT_TRANSITION' }) as Error,
      );
    },
  );

  it('refuza tranzitiile invalide (de ex. CREATED nu mai poate esua, doar FAILED se reia)', () => {
    expect(() => created().failed('x', T1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHIPMENT_TRANSITION' }) as Error,
    );
    expect(() => created().created('FC-2', 'TRK-2', T1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHIPMENT_TRANSITION' }) as Error,
    );
    expect(() => start().retry(T1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHIPMENT_TRANSITION' }) as Error,
    );
  });

  it('isTrackable: doar un colet aflat la curier si nefinalizat', () => {
    expect(start().isTrackable()).toBe(false);
    expect(created().isTrackable()).toBe(true);
    expect(created().tracked('IN_TRANSIT', T1).isTrackable()).toBe(true);
    expect(created().tracked('DELIVERED', T1).isTrackable()).toBe(false);
  });

  it('restore() refuza date incoerente: colet preluat fara id/urmarire, cost negativ', () => {
    expect(() =>
      Shipment.restore({ ...created(), externalId: null, status: 'CREATED' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SHIPMENT' }) as Error);
    expect(() =>
      Shipment.restore({ ...created(), trackingNumber: null, status: 'DELIVERED' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SHIPMENT' }) as Error);
    expect(() => Shipment.restore({ ...start(), cost: Money.of(-1, 'RON') })).toThrowError(
      expect.objectContaining({ code: 'INVALID_SHIPMENT' }) as Error,
    );
  });
});
