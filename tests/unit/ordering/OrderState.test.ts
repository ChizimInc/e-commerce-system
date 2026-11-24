import { describe, expect, it } from 'vitest';
import { Order } from '../../../src/modules/ordering/domain/Order';
import { ORDER_STATUSES, type OrderStatus } from '../../../src/modules/ordering/domain/OrderTypes';
import { CancelledState } from '../../../src/modules/ordering/domain/state/CancelledState';
import { DeliveredState } from '../../../src/modules/ordering/domain/state/DeliveredState';
import { NewState } from '../../../src/modules/ordering/domain/state/NewState';
import { PaidState } from '../../../src/modules/ordering/domain/state/PaidState';
import { RefundedState } from '../../../src/modules/ordering/domain/state/RefundedState';
import { ShippedState } from '../../../src/modules/ordering/domain/state/ShippedState';
import { PATH_TO_STATE, STATUS_OF_PATH, makeOrder } from '../../helpers/order-fixtures';

/**
 * State (B2): matricea completa a tranzitiilor. Fiecare stare × fiecare actiune este verificata:
 * tranzitiile valide duc in starea asteptata, TOATE celelalte arunca INVALID_ORDER_TRANSITION.
 */

type Action = 'pay' | 'ship' | 'deliver' | 'cancel' | 'refund';
const ACTIONS: Action[] = ['pay', 'ship', 'deliver', 'cancel', 'refund'];

/** Tranzitiile valide din fiecare stare (cheia = calea prin care se ajunge in acea stare). */
const VALID: Record<string, Partial<Record<Action, OrderStatus>>> = {
  NEW: { pay: 'PAID', cancel: 'CANCELLED' },
  PAID: { ship: 'SHIPPED', cancel: 'CANCELLED' },
  SHIPPED: { deliver: 'DELIVERED' },
  DELIVERED: {},
  CANCELLED_UNPAID: {}, // anulata inainte de plata: nimic de rambursat
  CANCELLED_PAID: { refund: 'REFUNDED' },
  REFUNDED: {},
};

const ACTION_TARGET: Record<Action, OrderStatus> = {
  pay: 'PAID',
  ship: 'SHIPPED',
  deliver: 'DELIVERED',
  cancel: 'CANCELLED',
  refund: 'REFUNDED',
};

const cases = Object.keys(VALID).flatMap((from) =>
  ACTIONS.map((action) => ({ from, action, expected: VALID[from]?.[action] })),
);

describe('State: tranzitiile comenzii', () => {
  it('o comanda noua porneste in NEW, nu e platita si e acoperita de matrice', () => {
    const order = makeOrder();
    expect(order.status).toBe('NEW');
    expect(order.paidAt).toBeNull();
    expect(Object.keys(PATH_TO_STATE)).toEqual(Object.keys(VALID));
  });

  describe.each(cases)('$from -> $action()', ({ from, action, expected }) => {
    const reach = () => PATH_TO_STATE[from]!(makeOrder());

    if (expected) {
      it(`este valida si duce in ${expected}`, () => {
        const before = reach();
        const after = before[action]();
        expect(after.status).toBe(expected);
        expect(before.status).toBe(STATUS_OF_PATH[from]); // comanda initiala ramane neschimbata (imutabila)
      });
    } else {
      it(`este invalida si arunca INVALID_ORDER_TRANSITION`, () => {
        const order = reach();
        expect(() => order[action]()).toThrowError(
          expect.objectContaining({
            code: 'INVALID_ORDER_TRANSITION',
            message: expect.stringContaining(
              `${STATUS_OF_PATH[from]} -> ${ACTION_TARGET[action]}`,
            ) as string,
          }) as Error,
        );
      });
    }
  });

  describe.each(Object.keys(VALID))('transitionTo() din %s', (from) => {
    it.each(ORDER_STATUSES)('catre %s', (target) => {
      const order = PATH_TO_STATE[from]!(makeOrder());
      const action = ACTIONS.find((a) => ACTION_TARGET[a] === target);
      const allowed = action ? VALID[from]?.[action] : undefined;
      if (allowed) {
        expect(order.transitionTo(target).status).toBe(allowed);
      } else {
        // include NEW ca tinta: nicio comanda nu se poate "redeschide"
        expect(() => order.transitionTo(target)).toThrowError(
          expect.objectContaining({ code: 'INVALID_ORDER_TRANSITION' }) as Error,
        );
      }
    });
  });

  it('un lant complet de tranzitii valide: NEW -> PAID -> SHIPPED -> DELIVERED', () => {
    const delivered = makeOrder().pay().ship().deliver();
    expect(delivered.status).toBe('DELIVERED');
  });

  it('o comanda platita si anulata se ramburseaza: NEW -> PAID -> CANCELLED -> REFUNDED', () => {
    expect(makeOrder().pay().cancel().refund().status).toBe('REFUNDED');
  });

  it('platile nu se pot dubla (NFR4): a doua plata e respinsa', () => {
    const paid = makeOrder().pay();
    expect(() => paid.pay()).toThrowError(/PAID -> PAID/);
  });

  describe('momentul platii', () => {
    it('pay() il seteaza, iar celelalte tranzitii il pastreaza (inclusiv dupa anulare)', () => {
      const at = new Date('2026-03-04T05:06:07.000Z');
      const paid = makeOrder().pay(at);
      expect(paid.paidAt).toEqual(at);
      expect(paid.ship().paidAt).toEqual(at);
      expect(paid.cancel().paidAt).toEqual(at);
    });

    it('o comanda anulata fara plata nu are paidAt', () => {
      expect(makeOrder().cancel().paidAt).toBeNull();
    });
  });

  describe('reconstruirea din persistenta (restore)', () => {
    it.each(Object.keys(VALID))('%s: starea restaurata se comporta ca cea originala', (from) => {
      const original = PATH_TO_STATE[from]!(makeOrder());
      const restored = Order.restore({
        id: original.id,
        customerId: original.customerId,
        items: original.items,
        address: original.address,
        deliveryMethod: original.deliveryMethod,
        paymentMethod: original.paymentMethod,
        price: original.price,
        createdAt: original.createdAt,
        status: original.status,
        paidAt: original.paidAt,
      });
      expect(restored.status).toBe(original.status);
      for (const action of ACTIONS) {
        const expected = VALID[from]?.[action];
        if (expected) expect(restored[action]().status).toBe(expected);
        else expect(() => restored[action]()).toThrowError(/Tranzitie invalida/);
      }
    });
  });

  describe('clasele de stare (Pattern: State)', () => {
    it('fiecare stare isi expune statusul', () => {
      expect(new NewState().status).toBe('NEW');
      expect(new PaidState().status).toBe('PAID');
      expect(new ShippedState().status).toBe('SHIPPED');
      expect(new DeliveredState().status).toBe('DELIVERED');
      expect(new CancelledState({ wasPaid: true }).status).toBe('CANCELLED');
      expect(new RefundedState().status).toBe('REFUNDED');
    });

    it('starile se tranziteaza intre ele fara a trece prin Order (comportament polimorfic)', () => {
      expect(new NewState().pay()).toBeInstanceOf(PaidState);
      expect(new NewState().cancel()).toBeInstanceOf(CancelledState);
      expect(new PaidState().ship()).toBeInstanceOf(ShippedState);
      expect(new ShippedState().deliver()).toBeInstanceOf(DeliveredState);
      expect(new PaidState().cancel().refund()).toBeInstanceOf(RefundedState);
      expect(() => new NewState().cancel().refund()).toThrowError(/CANCELLED -> REFUNDED/);
    });
  });
});
