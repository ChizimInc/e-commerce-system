import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentTimeoutError,
} from '../../../domain/errors';
import type {
  Authorization,
  AuthorizeRequest,
  Capture,
  CaptureRequest,
  PaymentGateway,
  Refund,
  RefundRequest,
} from '../../../ports/out/PaymentGateway';
import {
  PayPalApiError,
  PayPalNetworkError,
  type PayPalAmount,
  type PayPalMockClient,
} from './PayPalMockClient';

/** Erorile PayPal care inseamna "instrumentul de plata a fost refuzat", nu o defectiune. */
const DECLINE_NAMES: ReadonlySet<string> = new Set([
  'INSTRUMENT_DECLINED',
  'PAYER_ACCOUNT_RESTRICTED',
]);

/** 1234 cenți -> "12.34" (PayPal cere sume zecimale ca text; aritmetica ramane pe intregi). */
function toPayPalAmount(cents: number, currency: string): PayPalAmount {
  const major = Math.floor(cents / 100);
  const minor = String(cents % 100).padStart(2, '0');
  return { currency_code: currency, value: `${major}.${minor}` };
}

/** Erorile clientului PayPal, traduse in erorile portului `PaymentGateway`. */
function translate(error: unknown): Error {
  if (error instanceof PayPalNetworkError) {
    return new PaymentTimeoutError('PayPal nu a raspuns la timp', { cause: error });
  }
  if (error instanceof PayPalApiError) {
    if (DECLINE_NAMES.has(error.errorName)) {
      return new PaymentDeclinedError('PayPal a refuzat plata', error.errorName.toLowerCase());
    }
    return new PaymentProviderError(`PayPal: ${error.errorName}`, { cause: error });
  }
  return new PaymentProviderError('PayPal: eroare neasteptata', { cause: error });
}

// Pattern: Adapter (Structural) – aduce clientul PayPal (createOrder + authorizeOrder, sume zecimale ca text, erori cu `name`) la portul PaymentGateway
export class PayPalGateway implements PaymentGateway {
  constructor(private readonly client: PayPalMockClient) {}

  /** PayPal rezerva in doi pasi (creeaza comanda, apoi o autorizeaza); portul vede o singura operatie. */
  async authorize({
    paymentId,
    reference,
    amount,
    idempotencyKey,
  }: AuthorizeRequest): Promise<Authorization> {
    const requestId = { requestId: idempotencyKey };
    const created = await this.call(() =>
      this.client.createOrder(
        {
          intent: 'AUTHORIZE',
          purchase_units: [
            {
              invoice_id: reference,
              custom_id: paymentId,
              amount: toPayPalAmount(amount.amount, amount.currency),
            },
          ],
        },
        requestId,
      ),
    );
    const authorized = await this.call(() => this.client.authorizeOrder(created.id, requestId));
    const authorization = authorized.purchase_units[0]?.payments.authorizations[0];
    if (authorized.status !== 'COMPLETED' || !authorization) {
      throw new PaymentProviderError('PayPal: raspuns de autorizare fara autorizare');
    }
    return { externalId: authorization.id };
  }

  /** Id-ul de referinta dupa captare este al CAPTURII (cel cu care se ramburseaza), nu al autorizarii. */
  async capture({ externalId, amount, idempotencyKey }: CaptureRequest): Promise<Capture> {
    const capture = await this.call(() =>
      this.client.captureAuthorization(
        externalId,
        { amount: toPayPalAmount(amount.amount, amount.currency), final_capture: true },
        { requestId: idempotencyKey },
      ),
    );
    if (capture.status !== 'COMPLETED') {
      throw new PaymentProviderError('PayPal: captarea nu a fost confirmata');
    }
    return { externalId: capture.id };
  }

  async refund({ externalId, amount, idempotencyKey }: RefundRequest): Promise<Refund> {
    const refund = await this.call(() =>
      this.client.refundCapture(
        externalId,
        { amount: toPayPalAmount(amount.amount, amount.currency) },
        { requestId: idempotencyKey },
      ),
    );
    if (refund.status !== 'COMPLETED') {
      throw new PaymentProviderError('PayPal: rambursarea nu a fost confirmata');
    }
    return { externalId: refund.id };
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw translate(error);
    }
  }
}
