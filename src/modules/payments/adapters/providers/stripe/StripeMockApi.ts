import { IdempotencyCache, MOCK_AMOUNTS, newRunId } from '../mock-support';

/*
 * MOCK local al SDK-ului Stripe (fara retea). Forma API-ului copiaza deliberat stilul Stripe, diferit de al celorlalti
 * furnizori: spatii de nume (`paymentIntents.create`), campuri snake_case, moneda cu litere mici, `status` pe obiect,
 * erori aruncate cu `type` si `code`.
 */

export type StripeErrorType =
  'card_error' | 'api_error' | 'api_connection_error' | 'invalid_request_error';

/** Eroarea SDK-ului: `type` spune categoria, `code` cauza (ex. `card_declined`). */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly type: StripeErrorType,
    readonly code?: string,
    readonly decline_code?: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

export interface StripePaymentIntent {
  readonly id: string;
  readonly object: 'payment_intent';
  readonly amount: number;
  readonly amount_received: number;
  readonly currency: string;
  readonly status: 'requires_capture' | 'succeeded';
  readonly description: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripeRefund {
  readonly id: string;
  readonly object: 'refund';
  readonly payment_intent: string;
  readonly amount: number;
  readonly status: 'succeeded';
}

export interface StripeRequestOptions {
  readonly idempotencyKey?: string;
}

export interface StripeCreateIntentParams {
  readonly amount: number;
  readonly currency: string;
  readonly capture_method: 'manual';
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export class StripeMockApi {
  private readonly intents = new Map<string, StripePaymentIntent>();
  private readonly refundStore = new Map<string, StripeRefund>();
  private readonly idempotency = new IdempotencyCache();
  private readonly runId = newRunId();
  private sequence = 0;

  readonly paymentIntents = {
    create: (
      params: StripeCreateIntentParams,
      options: StripeRequestOptions = {},
    ): Promise<StripePaymentIntent> => this.respond(() => this.createIntent(params, options)),
    capture: (
      id: string,
      params: { amount_to_capture?: number } = {},
      options: StripeRequestOptions = {},
    ): Promise<StripePaymentIntent> => this.respond(() => this.captureIntent(id, params, options)),
  };

  readonly refunds = {
    create: (
      params: { payment_intent: string; amount?: number },
      options: StripeRequestOptions = {},
    ): Promise<StripeRefund> => this.respond(() => this.createRefund(params, options)),
  };

  /** Pentru teste: intentiile incasate pana acum. */
  capturedIntents(): readonly StripePaymentIntent[] {
    return [...this.intents.values()].filter((intent) => intent.status === 'succeeded');
  }

  /** Pentru teste: rambursarile facute pana acum. */
  issuedRefunds(): readonly StripeRefund[] {
    return [...this.refundStore.values()];
  }

  /** Ca un SDK real, raspunde asincron; o exceptie devine promisiune respinsa. */
  private respond<T>(operation: () => T): Promise<T> {
    return new Promise((resolve) => {
      resolve(operation());
    });
  }

  private createIntent(
    params: StripeCreateIntentParams,
    { idempotencyKey }: StripeRequestOptions,
  ): StripePaymentIntent {
    const replayed = this.idempotency.replay<StripePaymentIntent>('create', idempotencyKey);
    if (replayed) return replayed;

    if (params.amount === MOCK_AMOUNTS.DECLINE) {
      throw new StripeError(
        'Your card was declined.',
        'card_error',
        'card_declined',
        'generic_decline',
      );
    }
    if (params.amount === MOCK_AMOUNTS.PROVIDER_ERROR) {
      throw new StripeError('An error occurred with our API.', 'api_error');
    }
    if (params.amount === MOCK_AMOUNTS.TIMEOUT) {
      throw new StripeError(
        'An error occurred with our connection to Stripe.',
        'api_connection_error',
      );
    }
    const intent: StripePaymentIntent = {
      id: `pi_mock_${this.runId}_${String(++this.sequence).padStart(4, '0')}`,
      object: 'payment_intent',
      amount: params.amount,
      amount_received: 0,
      currency: params.currency,
      status: 'requires_capture',
      description: params.description ?? null,
      metadata: params.metadata ?? {},
    };
    this.intents.set(intent.id, intent);
    return this.idempotency.remember('create', idempotencyKey, intent);
  }

  private captureIntent(
    id: string,
    params: { amount_to_capture?: number },
    { idempotencyKey }: StripeRequestOptions,
  ): StripePaymentIntent {
    const replayed = this.idempotency.replay<StripePaymentIntent>('capture', idempotencyKey);
    if (replayed) return replayed;

    const intent = this.intents.get(id);
    if (!intent) {
      throw new StripeError(
        `No such payment_intent: '${id}'`,
        'invalid_request_error',
        'resource_missing',
      );
    }
    if (intent.status !== 'requires_capture') {
      throw new StripeError(
        'This PaymentIntent could not be captured because it has already been captured.',
        'invalid_request_error',
        'payment_intent_unexpected_state',
      );
    }
    const amount = params.amount_to_capture ?? intent.amount;
    const captured: StripePaymentIntent = {
      ...intent,
      status: 'succeeded',
      amount_received: amount,
    };
    this.intents.set(id, captured);
    return this.idempotency.remember('capture', idempotencyKey, captured);
  }

  private createRefund(
    params: { payment_intent: string; amount?: number },
    { idempotencyKey }: StripeRequestOptions,
  ): StripeRefund {
    const replayed = this.idempotency.replay<StripeRefund>('refund', idempotencyKey);
    if (replayed) return replayed;

    const intent = this.intents.get(params.payment_intent);
    if (!intent) {
      throw new StripeError(
        `No such payment_intent: '${params.payment_intent}'`,
        'invalid_request_error',
        'resource_missing',
      );
    }
    if (intent.status !== 'succeeded') {
      throw new StripeError(
        'The PaymentIntent has not been captured.',
        'invalid_request_error',
        'charge_not_captured',
      );
    }
    if (intent.amount === MOCK_AMOUNTS.REFUND_FAILURE) {
      throw new StripeError('An error occurred with our API.', 'api_error');
    }
    const amount = params.amount ?? intent.amount_received;
    const alreadyRefunded = [...this.refundStore.values()]
      .filter((refund) => refund.payment_intent === intent.id)
      .reduce((sum, refund) => sum + refund.amount, 0);
    if (alreadyRefunded + amount > intent.amount_received) {
      throw new StripeError(
        'Refund amount is greater than the charge amount.',
        'invalid_request_error',
        'charge_already_refunded',
      );
    }
    const refund: StripeRefund = {
      id: `re_mock_${this.runId}_${String(++this.sequence).padStart(4, '0')}`,
      object: 'refund',
      payment_intent: intent.id,
      amount,
      status: 'succeeded',
    };
    this.refundStore.set(refund.id, refund);
    return this.idempotency.remember('refund', idempotencyKey, refund);
  }
}
