import type { Money } from '../../../../shared';
import type { TrackingStatus } from '../../domain/ShippingTypes';

/** Destinatarul coletului, asa cum il cere orice curier (date personale: nu se logheaza). */
export interface CourierRecipient {
  readonly name: string;
  readonly street: string;
  readonly city: string;
  readonly postalCode: string;
  /** Cod ISO 3166-1 alpha-2. */
  readonly country: string;
}

export interface CreateCourierShipmentRequest {
  /** Referinta de corelare la curier (id-ul comenzii). */
  readonly reference: string;
  readonly recipient: CourierRecipient;
  /** Numarul de bucati din colet (curierii isi calculeaza singuri greutatea/volumul din el). */
  readonly units: number;
  /** Valoarea declarata a coletului (totalul comenzii). */
  readonly declaredValue: Money;
  /** Aceeasi cheie la o reluare => curierul nu creeaza un al doilea colet. */
  readonly idempotencyKey: string;
}

export interface CourierShipment {
  /** Id-ul coletului la curier, necesar pentru urmarire. */
  readonly externalId: string;
  /** Numarul de urmarire dat clientului. */
  readonly trackingNumber: string;
}

export interface CourierTracking {
  readonly status: TrackingStatus;
}

/**
 * Port de iesire: operatiile pe care domeniul le cere oricarui curier. Fiecare curier are un adaptor (Adapter)
 * care traduce API-ul lui propriu in aceste doua operatii.
 *
 * Contract de erori (adaptorul traduce codurile curierului):
 *  - `CourierRejectedError`: curierul a refuzat coletul (ex. adresa nelivrabila), rezultat de business;
 *  - `CourierProviderError`: eroare tehnica sau raspuns de neinteles;
 *  - `CourierTimeoutError`: nu a raspuns la timp.
 */
export interface CourierService {
  /** Preda coletul curierului. */
  createShipment(request: CreateCourierShipmentRequest): Promise<CourierShipment>;
  /** Starea curenta a unui colet preluat. */
  track(externalId: string): Promise<CourierTracking>;
}
