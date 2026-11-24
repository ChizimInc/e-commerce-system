import { BadGatewayError, DomainError, GatewayTimeoutError } from '../../../shared';

/** Curierul a refuzat coletul (adresa nelivrabila etc.): rezultat de business, nu defect (HTTP 422). */
export class CourierRejectedError extends DomainError {
  /** Cod scurt, stabil (ex. `address_not_serviceable`), pastrat pe livrare. */
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message, 'SHIPMENT_REJECTED');
  }
}

/** Curierul a raspuns cu o eroare tehnica sau cu un raspuns de neinteles (HTTP 502). */
export class CourierProviderError extends BadGatewayError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'COURIER_ERROR', options);
  }
}

/** Curierul nu a raspuns la timp (HTTP 504). */
export class CourierTimeoutError extends GatewayTimeoutError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'COURIER_TIMEOUT', options);
  }
}
