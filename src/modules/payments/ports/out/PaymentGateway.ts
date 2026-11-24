import type { Money } from '../../../../shared';

export interface AuthorizeRequest {
  /** Id-ul platii noastre (pentru corelare la furnizor). */
  readonly paymentId: string;
  /** Referinta de afisat pe extrasul/factura furnizorului (o stabileste procesorul fiecarui furnizor). */
  readonly reference: string;
  readonly amount: Money;
  /** Aceeasi cheie la o reluare => furnizorul nu creeaza o a doua autorizare. */
  readonly idempotencyKey: string;
}

export interface Authorization {
  /** Id-ul tranzactiei la furnizor, necesar pentru captare. */
  readonly externalId: string;
}

export interface CaptureRequest {
  readonly externalId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface Capture {
  /** Id-ul de folosit pentru rambursare (la unii furnizori difera de cel al autorizarii). */
  readonly externalId: string;
}

export interface RefundRequest {
  readonly externalId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface Refund {
  readonly externalId: string;
}

/**
 * Port de iesire: operatiile pe care domeniul le cere oricarui furnizor de plati. Fiecare furnizor are un
 * adaptor (Adapter) care traduce API-ul lui propriu in aceste trei operatii.
 *
 * Contract de erori (adaptorul traduce codurile furnizorului):
 *  - `PaymentDeclinedError`: furnizorul a refuzat plata (rezultat de business);
 *  - `PaymentProviderError`: eroare tehnica sau raspuns de neinteles;
 *  - `PaymentTimeoutError`: nu a raspuns la timp (rezultatul e necunoscut).
 */
export interface PaymentGateway {
  /** Rezerva suma. */
  authorize(request: AuthorizeRequest): Promise<Authorization>;
  /** Incaseaza suma rezervata. */
  capture(request: CaptureRequest): Promise<Capture>;
  /** Returneaza banii unei plati captate. */
  refund(request: RefundRequest): Promise<Refund>;
}
