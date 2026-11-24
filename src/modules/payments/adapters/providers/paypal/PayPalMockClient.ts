import { IdempotencyCache, MOCK_AMOUNTS, newRunId } from '../mock-support';

/*
 * MOCK local al clientului REST PayPal (fara retea). Stilul difera deliberat de Stripe: fluxul are doi pasi pentru
 * rezervare (`createOrder` + `authorizeOrder`), sumele sunt SIRURI zecimale ("12.34") in `amount.value`, moneda
 * e `currency_code` cu majuscule, statusurile sunt in majuscule, iar erorile au `name` (ex. INSTRUMENT_DECLINED).
 */

export interface PayPalAmount {
  readonly currency_code: string;
  /** Suma zecimala ca text, ex. "1234.50". */
  readonly value: string;
}

export interface PayPalPurchaseUnit {
  readonly invoice_id?: string;
  readonly custom_id?: string;
  readonly amount: PayPalAmount;
}

export interface PayPalOrder {
  readonly id: string;
  readonly status: 'CREATED' | 'COMPLETED';
}

export interface PayPalAuthorizedOrder {
  readonly id: string;
  readonly status: 'COMPLETED';
  readonly purchase_units: readonly {
    readonly payments: {
      readonly authorizations: readonly {
        readonly id: string;
        readonly status: 'CREATED';
        readonly amount: PayPalAmount;
      }[];
    };
  }[];
}

export interface PayPalCapture {
  readonly id: string;
  readonly status: 'COMPLETED';
  readonly amount: PayPalAmount;
}

export interface PayPalRefund {
  readonly id: string;
  readonly status: 'COMPLETED';
  readonly amount: PayPalAmount;
}

export interface PayPalRequestHeaders {
  /** Echivalentul antetului `PayPal-Request-Id`: aceeasi valoare => acelasi raspuns. */
  readonly requestId?: string;
}

/** Eroare de API: `name` e codul PayPal (INSTRUMENT_DECLINED, INTERNAL_SERVER_ERROR, RESOURCE_NOT_FOUND...). */
export class PayPalApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorName: string,
    message: string,
    readonly debug_id = 'mock-debug-id',
  ) {
    super(message);
    this.name = 'PayPalApiError';
  }
}

/** Esec de retea (nu a venit niciun raspuns). */
export class PayPalNetworkError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor() {
    super('connect ETIMEDOUT api-m.paypal.com');
    this.name = 'PayPalNetworkError';
  }
}

function toCents(value: string): number {
  return Math.round(Number(value) * 100);
}

interface StoredOrder {
  readonly units: readonly PayPalPurchaseUnit[];
  authorizationId: string | null;
}

interface StoredAuthorization {
  readonly amount: PayPalAmount;
  captureId: string | null;
}

export class PayPalMockClient {
  private readonly orders = new Map<string, StoredOrder>();
  private readonly authorizations = new Map<string, StoredAuthorization>();
  private readonly captures = new Map<string, PayPalCapture>();
  private readonly refundStore = new Map<string, { refund: PayPalRefund; captureId: string }>();
  private readonly idempotency = new IdempotencyCache();
  private readonly runId = newRunId();
  private sequence = 0;

  createOrder(
    body: { intent: 'AUTHORIZE'; purchase_units: readonly PayPalPurchaseUnit[] },
    { requestId }: PayPalRequestHeaders = {},
  ): Promise<PayPalOrder> {
    return this.respond(() => {
      const replayed = this.idempotency.replay<PayPalOrder>('createOrder', requestId);
      if (replayed) return replayed;
      if (body.purchase_units.length !== 1) {
        throw new PayPalApiError(422, 'INVALID_REQUEST', 'Exactly one purchase unit is supported.');
      }
      const order: PayPalOrder = { id: this.nextId('PP-ORDER'), status: 'CREATED' };
      this.orders.set(order.id, { units: body.purchase_units, authorizationId: null });
      return this.idempotency.remember('createOrder', requestId, order);
    });
  }

  authorizeOrder(
    orderId: string,
    { requestId }: PayPalRequestHeaders = {},
  ): Promise<PayPalAuthorizedOrder> {
    return this.respond(() => {
      const replayed = this.idempotency.replay<PayPalAuthorizedOrder>('authorizeOrder', requestId);
      if (replayed) return replayed;

      const order = this.orders.get(orderId);
      const unit = order?.units[0];
      if (!order || !unit)
        throw new PayPalApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'The specified resource does not exist.',
        );
      if (order.authorizationId !== null) {
        throw new PayPalApiError(422, 'ORDER_ALREADY_AUTHORIZED', 'Order already authorized.');
      }

      const cents = toCents(unit.amount.value);
      if (cents === MOCK_AMOUNTS.DECLINE) {
        throw new PayPalApiError(
          422,
          'INSTRUMENT_DECLINED',
          'The instrument presented was either declined by the processor or bank.',
        );
      }
      if (cents === MOCK_AMOUNTS.PROVIDER_ERROR) {
        throw new PayPalApiError(
          500,
          'INTERNAL_SERVER_ERROR',
          'An internal service error has occurred.',
        );
      }
      if (cents === MOCK_AMOUNTS.TIMEOUT) throw new PayPalNetworkError();

      const authorizationId = this.nextId('PP-AUTH');
      order.authorizationId = authorizationId;
      this.authorizations.set(authorizationId, { amount: unit.amount, captureId: null });
      return this.idempotency.remember('authorizeOrder', requestId, {
        id: orderId,
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              authorizations: [{ id: authorizationId, status: 'CREATED', amount: unit.amount }],
            },
          },
        ],
      } satisfies PayPalAuthorizedOrder);
    });
  }

  captureAuthorization(
    authorizationId: string,
    body: { amount: PayPalAmount; final_capture: boolean },
    { requestId }: PayPalRequestHeaders = {},
  ): Promise<PayPalCapture> {
    return this.respond(() => {
      const replayed = this.idempotency.replay<PayPalCapture>('capture', requestId);
      if (replayed) return replayed;

      const authorization = this.authorizations.get(authorizationId);
      if (!authorization)
        throw new PayPalApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'The specified resource does not exist.',
        );
      if (authorization.captureId !== null) {
        throw new PayPalApiError(
          422,
          'AUTHORIZATION_ALREADY_CAPTURED',
          'Authorization has already been captured.',
        );
      }
      const capture: PayPalCapture = {
        id: this.nextId('PP-CAP'),
        status: 'COMPLETED',
        amount: body.amount,
      };
      authorization.captureId = capture.id;
      this.captures.set(capture.id, capture);
      return this.idempotency.remember('capture', requestId, capture);
    });
  }

  refundCapture(
    captureId: string,
    body: { amount: PayPalAmount },
    { requestId }: PayPalRequestHeaders = {},
  ): Promise<PayPalRefund> {
    return this.respond(() => {
      const replayed = this.idempotency.replay<PayPalRefund>('refund', requestId);
      if (replayed) return replayed;

      const capture = this.captures.get(captureId);
      if (!capture)
        throw new PayPalApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'The specified resource does not exist.',
        );
      if (toCents(capture.amount.value) === MOCK_AMOUNTS.REFUND_FAILURE) {
        throw new PayPalApiError(
          500,
          'INTERNAL_SERVER_ERROR',
          'An internal service error has occurred.',
        );
      }
      const alreadyRefunded = [...this.refundStore.values()]
        .filter((stored) => stored.captureId === captureId)
        .reduce((sum, { refund }) => sum + toCents(refund.amount.value), 0);
      if (alreadyRefunded + toCents(body.amount.value) > toCents(capture.amount.value)) {
        throw new PayPalApiError(
          422,
          'CAPTURE_FULLY_REFUNDED',
          'The capture has already been fully refunded.',
        );
      }
      const refund: PayPalRefund = {
        id: this.nextId('PP-REF'),
        status: 'COMPLETED',
        amount: body.amount,
      };
      this.refundStore.set(refund.id, { refund, captureId });
      return this.idempotency.remember('refund', requestId, refund);
    });
  }

  /** Pentru teste: capturile facute pana acum. */
  completedCaptures(): readonly PayPalCapture[] {
    return [...this.captures.values()];
  }

  /** Pentru teste: rambursarile facute pana acum. */
  issuedRefunds(): readonly PayPalRefund[] {
    return [...this.refundStore.values()].map(({ refund }) => refund);
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.runId}-${String(++this.sequence).padStart(4, '0')}`;
  }

  private respond<T>(operation: () => T): Promise<T> {
    return new Promise((resolve) => {
      resolve(operation());
    });
  }
}
