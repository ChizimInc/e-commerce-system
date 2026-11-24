import { systemClock, type Clock } from '../../../../../shared';
import {
  IdempotencyCache,
  newRunId,
  simulatedFailureFor,
  type TransitTimes,
} from '../mock-support';

/*
 * MOCK local al API-ului unui curier rapid (fara retea). Forma API-ului este deliberat diferita de a Postei:
 * spatii de nume (`shipments.book`), campuri camelCase, valoarea in unitati minore (numar), erori aruncate
 * cu `httpStatus` si `errorCode`, stari textuale (`BOOKED`, `ON_ROUTE`, ...).
 */

/** Eroarea clientului: `httpStatus` spune categoria (422 refuz, 5xx eroare), `errorCode` cauza. */
export class FastCourierApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly errorCode: string,
  ) {
    super(message);
    this.name = 'FastCourierApiError';
  }
}

export interface FastCourierBookRequest {
  readonly reference: string;
  readonly dropoff: {
    readonly contact: string;
    readonly line1: string;
    readonly locality: string;
    readonly zip: string;
    readonly countryCode: string;
  };
  readonly parcels: number;
  /** Valoarea declarata, in unitati minore (cenți). */
  readonly declaredValueMinor: number;
  /** Moneda cu litere mari (ISO 4217). */
  readonly currencyCode: string;
}

export interface FastCourierBooking {
  readonly awb: string;
  readonly trackingUrl: string;
  readonly serviceLevel: 'EXPRESS_24H';
}

export type FastCourierState = 'BOOKED' | 'ON_ROUTE' | 'DELIVERED' | 'RETURNED_TO_SENDER';

export interface FastCourierStatus {
  readonly awb: string;
  readonly state: FastCourierState;
}

export interface FastCourierRequestOptions {
  readonly idempotencyKey?: string;
}

export interface FastCourierMockOptions {
  readonly clock?: Clock;
  /** Curierul rapid: in tranzit dupa 1 minut, livrat dupa 4 ore. */
  readonly transit?: TransitTimes;
}

const DEFAULT_TRANSIT: TransitTimes = {
  inTransitAfterMs: 60_000,
  deliveredAfterMs: 4 * 60 * 60_000,
};

interface BookedParcel {
  readonly booking: FastCourierBooking;
  readonly bookedAt: Date;
}

// Mock-ul unui API extern: nu e pattern, ci tinta pe care o adapteaza `FastCourierAdapter`.
export class FastCourierMock {
  private readonly parcels = new Map<string, BookedParcel>();
  private readonly idempotency = new IdempotencyCache();
  private readonly runId = newRunId();
  private readonly clock: Clock;
  private readonly transit: TransitTimes;
  private sequence = 0;

  constructor({ clock = systemClock, transit = DEFAULT_TRANSIT }: FastCourierMockOptions = {}) {
    this.clock = clock;
    this.transit = transit;
  }

  readonly shipments = {
    book: (
      request: FastCourierBookRequest,
      options: FastCourierRequestOptions = {},
    ): Promise<FastCourierBooking> => this.respond(() => this.book(request, options)),
    status: (awb: string): Promise<FastCourierStatus> => this.respond(() => this.statusOf(awb)),
  };

  /** Pentru teste: AWB-urile preluate pana acum. */
  bookedAwbs(): readonly string[] {
    return [...this.parcels.keys()];
  }

  /** Ca un client real, raspunde asincron; o exceptie devine promisiune respinsa. */
  private respond<T>(operation: () => T): Promise<T> {
    return new Promise((resolve) => {
      resolve(operation());
    });
  }

  private book(
    request: FastCourierBookRequest,
    { idempotencyKey }: FastCourierRequestOptions,
  ): FastCourierBooking {
    const replayed = this.idempotency.replay<FastCourierBooking>(idempotencyKey);
    if (replayed) return replayed;

    const failure = simulatedFailureFor(request.dropoff.zip, request.declaredValueMinor);
    if (failure === 'reject') {
      throw new FastCourierApiError(
        'Destination is outside our service area',
        422,
        'ADDRESS_NOT_SERVICEABLE',
      );
    }
    if (failure === 'error') {
      throw new FastCourierApiError('Internal error', 500, 'INTERNAL_ERROR');
    }
    if (failure === 'timeout') {
      throw new FastCourierApiError('Upstream did not answer', 504, 'UPSTREAM_TIMEOUT');
    }

    const awb = `FC${this.runId.toUpperCase()}${String(++this.sequence).padStart(5, '0')}`;
    const booking: FastCourierBooking = {
      awb,
      trackingUrl: `https://track.fastcourier.example/${awb}`,
      serviceLevel: 'EXPRESS_24H',
    };
    this.parcels.set(awb, { booking, bookedAt: this.clock() });
    return this.idempotency.remember(idempotencyKey, booking);
  }

  private statusOf(awb: string): FastCourierStatus {
    const parcel = this.parcels.get(awb);
    if (!parcel) throw new FastCourierApiError(`Unknown AWB: ${awb}`, 404, 'AWB_NOT_FOUND');
    const elapsed = this.clock().getTime() - parcel.bookedAt.getTime();
    const state: FastCourierState =
      elapsed >= this.transit.deliveredAfterMs
        ? 'DELIVERED'
        : elapsed >= this.transit.inTransitAfterMs
          ? 'ON_ROUTE'
          : 'BOOKED';
    return { awb, state };
  }
}
