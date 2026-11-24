import {
  CourierProviderError,
  CourierRejectedError,
  CourierTimeoutError,
} from '../../../domain/errors';
import type { TrackingStatus } from '../../../domain/ShippingTypes';
import type {
  CourierService,
  CourierShipment,
  CourierTracking,
  CreateCourierShipmentRequest,
} from '../../../ports/out/CourierService';
import {
  FastCourierApiError,
  type FastCourierMock,
  type FastCourierState,
} from './FastCourierMock';

const TRACKING_OF: Record<FastCourierState, TrackingStatus> = {
  BOOKED: 'CREATED',
  ON_ROUTE: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  RETURNED_TO_SENDER: 'RETURNED',
};

/** Codurile de eroare ale curierului rapid, traduse in erorile portului `CourierService`. */
function translate(error: unknown): Error {
  if (error instanceof FastCourierApiError) {
    if (error.httpStatus === 422) {
      return new CourierRejectedError(
        'Curierul rapid a refuzat coletul',
        'address_not_serviceable',
      );
    }
    if (error.httpStatus === 504) {
      return new CourierTimeoutError('Curierul rapid nu a raspuns la timp', { cause: error });
    }
    return new CourierProviderError(`Curierul rapid: ${error.errorCode}`, { cause: error });
  }
  return new CourierProviderError('Curierul rapid: eroare neasteptata', { cause: error });
}

// Pattern: Adapter (Structural) – aduce API-ul curierului rapid (shipments.book/status, AWB, valoare in unitati minore, erori cu httpStatus) la portul CourierService
export class FastCourierAdapter implements CourierService {
  constructor(private readonly api: FastCourierMock) {}

  async createShipment({
    reference,
    recipient,
    declaredValue,
    idempotencyKey,
  }: CreateCourierShipmentRequest): Promise<CourierShipment> {
    const booking = await this.call(() =>
      this.api.shipments.book(
        {
          reference,
          dropoff: {
            contact: recipient.name,
            line1: recipient.street,
            locality: recipient.city,
            zip: recipient.postalCode,
            countryCode: recipient.country,
          },
          parcels: 1,
          declaredValueMinor: declaredValue.amount,
          currencyCode: declaredValue.currency,
        },
        { idempotencyKey },
      ),
    );
    return { externalId: booking.awb, trackingNumber: booking.awb };
  }

  async track(externalId: string): Promise<CourierTracking> {
    const { state } = await this.call(() => this.api.shipments.status(externalId));
    return { status: TRACKING_OF[state] };
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw translate(error);
    }
  }
}
