import { BadGatewayError, DomainError, ForbiddenError, GatewayTimeoutError } from '../../../shared';

/** Furnizorul a refuzat plata (card refuzat, fonduri insuficiente etc.): rezultat de business, nu defect (HTTP 422). */
export class PaymentDeclinedError extends DomainError {
  /** Codul furnizorului, tradus in vocabularul nostru (ex. `card_declined`), pastrat pe plata. */
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message, 'PAYMENT_DECLINED');
  }
}

/** Furnizorul a raspuns cu o eroare tehnica sau cu un raspuns de neinteles (HTTP 502). */
export class PaymentProviderError extends BadGatewayError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PAYMENT_PROVIDER_ERROR', options);
  }
}

/** Furnizorul nu a raspuns la timp (HTTP 504). Rezultatul operatiei este necunoscut. */
export class PaymentTimeoutError extends GatewayTimeoutError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PAYMENT_PROVIDER_TIMEOUT', options);
  }
}

/** Plata nu respecta regulile furnizorului ales (limita de suma etc.), inainte de orice apel catre el (HTTP 422). */
export class PaymentRejectedError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

/** Semnatura webhook-ului lipseste sau nu corespunde (HTTP 403). */
export class InvalidWebhookSignatureError extends ForbiddenError {
  constructor(message = 'Semnatura webhook-ului este invalida') {
    super(message, 'INVALID_WEBHOOK_SIGNATURE');
  }
}

/** Corpul webhook-ului (semnat corect) nu are formatul asteptat de furnizor (HTTP 422). */
export class InvalidWebhookPayloadError extends DomainError {
  constructor(message = 'Corpul webhook-ului nu are formatul asteptat') {
    super(message, 'INVALID_WEBHOOK_PAYLOAD');
  }
}
