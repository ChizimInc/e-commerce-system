import { describe, expect, it } from 'vitest';
import { FastCourierAdapter } from '../../../src/modules/shipping/adapters/couriers/fast/FastCourierAdapter';
import { FastCourierMock } from '../../../src/modules/shipping/adapters/couriers/fast/FastCourierMock';
import { MOCK_TRIGGERS } from '../../../src/modules/shipping/adapters/couriers/mock-support';
import { PostOfficeAdapter } from '../../../src/modules/shipping/adapters/couriers/post/PostOfficeAdapter';
import { PostOfficeMock } from '../../../src/modules/shipping/adapters/couriers/post/PostOfficeMock';
import { StorePickupCourier } from '../../../src/modules/shipping/adapters/couriers/StorePickupCourier';
import type {
  CourierService,
  CreateCourierShipmentRequest,
} from '../../../src/modules/shipping/ports/out/CourierService';
import { Money } from '../../../src/shared';

const START = new Date('2026-06-01T10:00:00.000Z');

const parcel = (
  overrides: Partial<CreateCourierShipmentRequest> & { postalCode?: string } = {},
): CreateCourierShipmentRequest => ({
  reference: overrides.reference ?? 'order-1',
  recipient: {
    name: 'Ana Popescu',
    street: 'Str. Libertatii 10',
    city: 'Chisinau',
    postalCode: overrides.postalCode ?? 'MD-2001',
    country: 'MD',
  },
  units: overrides.units ?? 2,
  declaredValue: overrides.declaredValue ?? Money.of(12_345, 'RON'),
  idempotencyKey: overrides.idempotencyKey ?? 'ship:order-1',
});

/** Un ceas controlabil: mock-urile isi avanseaza coletele dupa timpul scurs de la preluare. */
function clockAt() {
  let now = START;
  return {
    clock: () => new Date(now),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Adapter (S1): doua API-uri externe cu forme incompatibile (curier rapid: `shipments.book`, erori cu `httpStatus`;
 * posta: `registerParcel`, fara exceptii, valoare text si coduri de rezultat) aduse la acelasi port `CourierService`.
 * Aceleasi cerinte de comportament ruleaza pe ambele, ca sa demonstreze ca sunt interschimbabile.
 */
const couriers: {
  name: string;
  create: (clock: () => Date) => { service: CourierService; ids: () => readonly string[] };
  inTransitAfter: number;
  deliveredAfter: number;
}[] = [
  {
    name: 'FastCourierAdapter (curier rapid)',
    create: (clock) => {
      const api = new FastCourierMock({ clock });
      return { service: new FastCourierAdapter(api), ids: () => api.bookedAwbs() };
    },
    inTransitAfter: MINUTE,
    deliveredAfter: 4 * HOUR,
  },
  {
    name: 'PostOfficeAdapter (posta)',
    create: (clock) => {
      const api = new PostOfficeMock({ clock });
      return { service: new PostOfficeAdapter(api), ids: () => api.registeredParcelIds() };
    },
    inTransitAfter: HOUR,
    deliveredAfter: 48 * HOUR,
  },
];

describe.each(couriers)('$name', ({ create, inTransitAfter, deliveredAfter }) => {
  it('preda coletul si intoarce id-ul la curier si numarul de urmarire', async () => {
    const { service, ids } = create(() => START);

    const shipment = await service.createShipment(parcel());

    expect(shipment.externalId).toMatch(/\S+/);
    expect(shipment.trackingNumber).toMatch(/\S+/);
    expect(ids()).toContain(shipment.externalId);
  });

  it('aceeasi cheie de idempotenta (reluare) nu creeaza un al doilea colet', async () => {
    const { service, ids } = create(() => START);

    const first = await service.createShipment(parcel());
    const again = await service.createShipment(parcel());

    expect(again).toEqual(first);
    expect(ids()).toHaveLength(1);
  });

  it('urmarirea avanseaza in timp: CREATED -> IN_TRANSIT -> DELIVERED', async () => {
    const time = clockAt();
    const { service } = create(time.clock);
    const { externalId } = await service.createShipment(parcel());

    expect((await service.track(externalId)).status).toBe('CREATED');
    time.advance(inTransitAfter);
    expect((await service.track(externalId)).status).toBe('IN_TRANSIT');
    time.advance(deliveredAfter);
    expect((await service.track(externalId)).status).toBe('DELIVERED');
  });

  it('urmarirea unui colet necunoscut e eroare tehnica (CourierProviderError)', async () => {
    const { service } = create(() => START);
    await expect(service.track('necunoscut')).rejects.toMatchObject({ code: 'COURIER_ERROR' });
  });

  describe.each([
    ['codul postal', (n: 0 | 1 | 2) => parcel({ postalCode: `0000${n}` })],
    [
      'valoarea declarata',
      (n: 0 | 1 | 2) =>
        parcel({
          declaredValue: Money.of(
            [MOCK_TRIGGERS.REJECT_VALUE, MOCK_TRIGGERS.ERROR_VALUE, MOCK_TRIGGERS.TIMEOUT_VALUE][
              n
            ] ?? 0,
            'RON',
          ),
        }),
    ],
  ])('esecuri simulate dupa %s', (_trigger, request) => {
    it('adresa nelivrabila -> CourierRejectedError (422), cu un cod stabil', async () => {
      const { service } = create(() => START);
      await expect(service.createShipment(request(0))).rejects.toMatchObject({
        code: 'SHIPMENT_REJECTED',
        reason: 'address_not_serviceable',
      });
    });

    it('eroare interna -> CourierProviderError (502)', async () => {
      const { service } = create(() => START);
      await expect(service.createShipment(request(1))).rejects.toMatchObject({
        code: 'COURIER_ERROR',
      });
    });

    it('lipsa raspunsului -> CourierTimeoutError (504)', async () => {
      const { service } = create(() => START);
      await expect(service.createShipment(request(2))).rejects.toMatchObject({
        code: 'COURIER_TIMEOUT',
      });
    });

    it('un esec nu e retinut: reluarea cu aceeasi cheie, pe o adresa buna, reuseste', async () => {
      const { service, ids } = create(() => START);
      await expect(service.createShipment(request(0))).rejects.toBeDefined();

      await service.createShipment(parcel());

      expect(ids()).toHaveLength(1);
    });
  });

  it('mock-urile au id-uri unice la fiecare pornire (lectia din Iteratia 4: indexul unic din PostgreSQL)', async () => {
    const first = await create(() => START).service.createShipment(parcel());
    const afterRestart = await create(() => START).service.createShipment(parcel());

    expect(afterRestart.externalId).not.toBe(first.externalId);
  });
});

describe('API-urile mock sunt incompatibile intre ele (motivul pentru care exista adaptoare)', () => {
  it('curierul rapid arunca exceptii cu httpStatus; posta intoarce coduri de rezultat, fara exceptii', async () => {
    const fast = new FastCourierMock();
    const post = new PostOfficeMock();

    await expect(
      fast.shipments.book({
        reference: 'r',
        dropoff: { contact: 'A', line1: 's', locality: 'c', zip: '00000', countryCode: 'MD' },
        parcels: 1,
        declaredValueMinor: 100,
        currencyCode: 'RON',
      }),
    ).rejects.toMatchObject({ httpStatus: 422, errorCode: 'ADDRESS_NOT_SERVICEABLE' });

    await expect(
      post.registerParcel({
        clientRef: 'r',
        receiver: { fullName: 'A', addressLine: 's', townName: 'c', postCode: '00000', iso2: 'MD' },
        weightGrams: 500,
        declaredValue: '1.00',
        currency: 'RON',
      }),
    ).resolves.toMatchObject({ resultCode: 101 });
  });

  it('posta foloseste cheia de idempotenta ca referinta de client: aceeasi cheie => acelasi colet, chiar daca referinta difera', async () => {
    const post = new PostOfficeAdapter(new PostOfficeMock());
    const first = await post.createShipment(parcel({ reference: 'a', idempotencyKey: 'ship:x' }));
    const again = await post.createShipment(parcel({ reference: 'b', idempotencyKey: 'ship:x' }));
    const other = await post.createShipment(parcel({ reference: 'a', idempotencyKey: 'ship:y' }));

    expect(again).toEqual(first);
    expect(other.externalId).not.toBe(first.externalId);
  });

  it('mesajul brut al postei nu ajunge in eroarea cu care raspunde API-ul (doar in cauza)', async () => {
    const post = new PostOfficeAdapter(new PostOfficeMock());
    let error = new Error('nu a esuat');
    try {
      await post.createShipment(parcel({ postalCode: '00001' }));
    } catch (e) {
      error = e as Error;
    }

    expect(error.message).not.toMatch(/Internal server error/);
    expect((error.cause as Error).message).toMatch(/Internal server error/);
  });

  it('posta primeste greutatea in grame si valoarea ca text cu doua zecimale', async () => {
    const post = new PostOfficeMock();
    let sent: unknown;
    const spy = {
      registerParcel: (request: Parameters<PostOfficeMock['registerParcel']>[0]) => {
        sent = request;
        return post.registerParcel(request);
      },
      getParcelEvents: (id: string) => post.getParcelEvents(id),
    } as unknown as PostOfficeMock;

    await new PostOfficeAdapter(spy).createShipment(
      parcel({ units: 3, declaredValue: Money.of(12_305, 'RON') }),
    );

    expect(sent).toMatchObject({ weightGrams: 1_500, declaredValue: '123.05', currency: 'RON' });
  });
});

describe('StorePickupCourier (ridicare din magazin, fara curier extern)', () => {
  it('pregateste coletul cu un cod de ridicare, unic pe pornire; starea ramane CREATED', async () => {
    const store = new StorePickupCourier();
    const first = await store.createShipment(parcel());
    const second = await store.createShipment(parcel({ reference: 'order-2' }));

    expect(first.externalId).toMatch(/^PICKUP-/);
    expect(first.trackingNumber).toBe(first.externalId);
    expect(second.externalId).not.toBe(first.externalId);
    expect((await store.track(first.externalId)).status).toBe('CREATED');
    expect((await new StorePickupCourier().createShipment(parcel())).externalId).not.toBe(
      first.externalId,
    );
  });

  it('un cod necunoscut (de ex. dupa repornire) e eroare tehnica', async () => {
    await expect(new StorePickupCourier().track('PICKUP-NECUNOSCUT')).rejects.toMatchObject({
      code: 'COURIER_ERROR',
    });
  });
});
