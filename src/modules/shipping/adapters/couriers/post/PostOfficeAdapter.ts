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
import type { PostOfficeEventCode, PostOfficeMock, PostOfficeResultCode } from './PostOfficeMock';

/** Greutatea estimata a unei bucati (nu exista greutate pe produse): posta cere greutatea coletului. */
const GRAMS_PER_UNIT = 500;

const TRACKING_OF: Record<PostOfficeEventCode, TrackingStatus> = {
  REG: 'CREATED',
  DEP: 'IN_TRANSIT',
  DLV: 'DELIVERED',
  RET: 'RETURNED',
};

/** "123.45" din cenți, fara float. */
function decimalString(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Codurile de rezultat ale postei (nu arunca exceptii), traduse in erorile portului `CourierService`. */
function failureOf(resultCode: PostOfficeResultCode, message: string): Error {
  if (resultCode === 101) {
    return new CourierRejectedError('Posta a refuzat coletul', 'address_not_serviceable');
  }
  if (resultCode === 504) return new CourierTimeoutError('Posta nu a raspuns la timp');
  // Mesajul brut al postei ramane doar in cauza (log), nu in raspunsul catre client.
  return new CourierProviderError(`Posta a raspuns cu eroare (cod ${resultCode})`, {
    cause: new Error(message),
  });
}

// Pattern: Adapter (Structural) – aduce clientul postei (registerParcel/getParcelEvents, fara exceptii, valoare text, greutate in grame, evenimente cu coduri) la portul CourierService
export class PostOfficeAdapter implements CourierService {
  constructor(private readonly client: PostOfficeMock) {}

  async createShipment({
    recipient,
    units,
    declaredValue,
    idempotencyKey,
  }: CreateCourierShipmentRequest): Promise<CourierShipment> {
    const response = await this.client.registerParcel({
      clientRef: idempotencyKey, // aceeasi cheie => acelasi colet
      receiver: {
        fullName: recipient.name,
        addressLine: recipient.street,
        townName: recipient.city,
        postCode: recipient.postalCode,
        iso2: recipient.country,
      },
      weightGrams: units * GRAMS_PER_UNIT,
      declaredValue: decimalString(declaredValue.amount),
      currency: declaredValue.currency,
    });
    if (response.resultCode !== 0) throw failureOf(response.resultCode, response.message);
    if (response.parcelId === undefined || response.barcode === undefined) {
      throw new CourierProviderError('Posta: raspuns fara id sau cod de bare');
    }
    return { externalId: response.parcelId, trackingNumber: response.barcode };
  }

  async track(externalId: string): Promise<CourierTracking> {
    const response = await this.client.getParcelEvents(externalId);
    if (response.resultCode !== 0) throw failureOf(response.resultCode, response.message);
    // Starea curenta e a ultimului eveniment (evenimentele vin in ordine cronologica).
    const last = response.events.at(-1);
    if (!last) throw new CourierProviderError('Posta: colet fara evenimente');
    return { status: TRACKING_OF[last.code] };
  }
}
