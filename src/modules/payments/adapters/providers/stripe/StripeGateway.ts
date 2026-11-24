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
import { StripeError, type StripeMockApi } from './StripeMockApi';

/** Codurile de eroare ale SDK-ului Stripe, traduse in erorile portului `PaymentGateway`. */
function translate(error: unknown): Error {
  if (error instanceof StripeError) {
    if (error.type === 'card_error') {
      return new PaymentDeclinedError('Stripe a refuzat plata', error.code ?? 'card_declined');
    }
    if (error.type === 'api_connection_error') {
      return new PaymentTimeoutError('Stripe nu a raspuns la timp', { cause: error });
    }
    return new PaymentProviderError(`Stripe: ${error.message}`, { cause: error });
  }
  return new PaymentProviderError('Stripe: eroare neasteptata', { cause: error });
}

// Pattern: Adapter (Structural) – aduce SDK-ul Stripe (paymentIntents.create/capture, refunds.create, suma + moneda cu litere mici, erori cu `type`) la portul PaymentGateway
export class StripeGateway implements PaymentGateway {
  constructor(private readonly api: StripeMockApi) {}

  async authorize({
    paymentId,
    reference,
    amount,
    idempotencyKey,
  }: AuthorizeRequest): Promise<Authorization> {
    const intent = await this.call(() =>
      this.api.paymentIntents.create(
        {
          amount: amount.amount,
          currency: amount.currency.toLowerCase(),
          capture_method: 'manual',
          description: reference,
          metadata: { payment_id: paymentId },
        },
        { idempotencyKey },
      ),
    );
    if (intent.status !== 'requires_capture') {
      throw new PaymentProviderError(
        `Stripe: stare neasteptata dupa autorizare (${intent.status})`,
      );
    }
    return { externalId: intent.id };
  }

  async capture({ externalId, amount, idempotencyKey }: CaptureRequest): Promise<Capture> {
    const intent = await this.call(() =>
      this.api.paymentIntents.capture(
        externalId,
        { amount_to_capture: amount.amount },
        { idempotencyKey },
      ),
    );
    if (intent.status !== 'succeeded') {
      throw new PaymentProviderError(`Stripe: stare neasteptata dupa captare (${intent.status})`);
    }
    return { externalId: intent.id };
  }

  async refund({ externalId, amount, idempotencyKey }: RefundRequest): Promise<Refund> {
    const refund = await this.call(() =>
      this.api.refunds.create(
        { payment_intent: externalId, amount: amount.amount },
        { idempotencyKey },
      ),
    );
    if (refund.status !== 'succeeded') {
      throw new PaymentProviderError('Stripe: rambursarea nu a fost confirmata');
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
