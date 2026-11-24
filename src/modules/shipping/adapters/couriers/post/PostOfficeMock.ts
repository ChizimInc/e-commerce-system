import { systemClock, type Clock } from '../../../../../shared';
import {
  IdempotencyCache,
  newRunId,
  simulatedFailureFor,
  type TransitTimes,
} from '../mock-support';

/*
 * MOCK local al clientului unei posti nationale (fara retea). Stil SOAP/RPC, deliberat diferit de curierul rapid:
 * metode plate (`registerParcel`, `getParcelEvents`), niciodata exceptii (raspunsul poarta `resultCode`),
 * greutatea in grame, valoarea declarata ca text cu doua zecimale ("12.34"), starea ca istoric de evenimente cu coduri scurte.
 */

/** 0 = reusit; 101 = adresa invalida; 500 = eroare interna; 504 = timeout; 404 = colet necunoscut. */
export type PostOfficeResultCode = 0 | 101 | 404 | 500 | 504;

export interface PostOfficeRegisterRequest {
  readonly clientRef: string;
  readonly receiver: {
    readonly fullName: string;
    readonly addressLine: string;
    readonly townName: string;
    readonly postCode: string;
    readonly iso2: string;
  };
  readonly weightGrams: number;
  /** Valoarea declarata cu doua zecimale, ex. `"123.45"`. */
  readonly declaredValue: string;
  readonly currency: string;
}

export interface PostOfficeRegisterResponse {
  readonly resultCode: PostOfficeResultCode;
  readonly message: string;
  readonly parcelId?: string;
  readonly barcode?: string;
}

/** REG = inregistrat, DEP = plecat din centrul de sortare, DLV = livrat, RET = returnat expeditorului. */
export type PostOfficeEventCode = 'REG' | 'DEP' | 'DLV' | 'RET';

export interface PostOfficeEventsResponse {
  readonly resultCode: PostOfficeResultCode;
  readonly message: string;
  readonly events: readonly { readonly code: PostOfficeEventCode; readonly at: string }[];
}

export interface PostOfficeMockOptions {
  readonly clock?: Clock;
  /** Posta: in tranzit dupa 1 ora, livrat dupa 2 zile. */
  readonly transit?: TransitTimes;
}

const DEFAULT_TRANSIT: TransitTimes = {
  inTransitAfterMs: 60 * 60_000,
  deliveredAfterMs: 48 * 60 * 60_000,
};

interface RegisteredParcel {
  readonly response: PostOfficeRegisterResponse;
  readonly registeredAt: Date;
}

// Mock-ul unui API extern: nu e pattern, ci tinta pe care o adapteaza `PostOfficeAdapter`.
export class PostOfficeMock {
  private readonly parcels = new Map<string, RegisteredParcel>();
  private readonly idempotency = new IdempotencyCache();
  private readonly runId = newRunId();
  private readonly clock: Clock;
  private readonly transit: TransitTimes;
  private sequence = 0;

  constructor({ clock = systemClock, transit = DEFAULT_TRANSIT }: PostOfficeMockOptions = {}) {
    this.clock = clock;
    this.transit = transit;
  }

  /** `idempotencyKey` = `clientRef` pe care il da apelantul: aceeasi referinta intoarce acelasi colet. */
  registerParcel(request: PostOfficeRegisterRequest): Promise<PostOfficeRegisterResponse> {
    return Promise.resolve(this.register(request));
  }

  getParcelEvents(parcelId: string): Promise<PostOfficeEventsResponse> {
    return Promise.resolve(this.eventsOf(parcelId));
  }

  /** Pentru teste: coletele inregistrate pana acum. */
  registeredParcelIds(): readonly string[] {
    return [...this.parcels.keys()];
  }

  private register(request: PostOfficeRegisterRequest): PostOfficeRegisterResponse {
    const replayed = this.idempotency.replay<PostOfficeRegisterResponse>(request.clientRef);
    if (replayed) return replayed;

    const declaredCents = Math.round(Number(request.declaredValue) * 100);
    const failure = simulatedFailureFor(request.receiver.postCode, declaredCents);
    if (failure === 'reject') {
      return { resultCode: 101, message: 'Invalid receiver address' };
    }
    if (failure === 'error') return { resultCode: 500, message: 'Internal server error' };
    if (failure === 'timeout') return { resultCode: 504, message: 'Sorting center timeout' };

    const parcelId = `PO-${this.runId}-${String(++this.sequence).padStart(5, '0')}`;
    const response: PostOfficeRegisterResponse = {
      resultCode: 0,
      message: 'OK',
      parcelId,
      barcode: `RR${this.runId.toUpperCase()}${String(this.sequence).padStart(5, '0')}RO`,
    };
    this.parcels.set(parcelId, { response, registeredAt: this.clock() });
    return this.idempotency.remember(request.clientRef, response);
  }

  private eventsOf(parcelId: string): PostOfficeEventsResponse {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { resultCode: 404, message: 'Unknown parcel', events: [] };
    const start = parcel.registeredAt.getTime();
    const elapsed = this.clock().getTime() - start;
    const at = (offsetMs: number): string => new Date(start + offsetMs).toISOString();
    const events: { code: PostOfficeEventCode; at: string }[] = [{ code: 'REG', at: at(0) }];
    if (elapsed >= this.transit.inTransitAfterMs) {
      events.push({ code: 'DEP', at: at(this.transit.inTransitAfterMs) });
    }
    if (elapsed >= this.transit.deliveredAfterMs) {
      events.push({ code: 'DLV', at: at(this.transit.deliveredAfterMs) });
    }
    return { resultCode: 0, message: 'OK', events };
  }
}
