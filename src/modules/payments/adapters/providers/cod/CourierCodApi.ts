import { IdempotencyCache, MOCK_AMOUNTS, newRunId } from '../mock-support';

/*
 * MOCK local al API-ului unui curier pentru ramburs (fara retea). Stilul difera deliberat de Stripe si PayPal:
 * metode cu nume de curier (`registerCodShipment`, `confirmCashCollected`, `refundCash`), cereri cu nume proprii
 * (`cashDueMinor`, `isoCurrency`), raspunsuri `{ ok, ... }` cu COD NUMERIC de eroare (`errCode`) in loc de exceptii.
 */

export const COD_ERR = {
  REJECTED: 17, // curierul nu preia ramburs pentru aceasta livrare
  NOT_FOUND: 404,
  TIMEOUT: 408,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export interface CodFailure {
  readonly ok: false;
  readonly errCode: number;
  readonly errText: string;
}

export type CodResult<T> = ({ readonly ok: true } & T) | CodFailure;

interface Shipment {
  readonly cashDueMinor: number;
  collected: boolean;
  refundedMinor: number;
}

const fail = (errCode: number, errText: string): CodFailure => ({ ok: false, errCode, errText });

export class CourierCodApi {
  private readonly shipments = new Map<string, Shipment>();
  private readonly idempotency = new IdempotencyCache();
  private readonly runId = newRunId();
  private sequence = 0;

  registerCodShipment(request: {
    orderRef: string;
    cashDueMinor: number;
    isoCurrency: string;
    clientToken?: string;
  }): Promise<CodResult<{ ticket: string }>> {
    const replayed = this.idempotency.replay<CodResult<{ ticket: string }>>(
      'register',
      request.clientToken,
    );
    if (replayed) return Promise.resolve(replayed);

    if (request.cashDueMinor === MOCK_AMOUNTS.DECLINE) {
      return Promise.resolve(
        fail(COD_ERR.REJECTED, 'Cash on delivery not available for this shipment'),
      );
    }
    if (request.cashDueMinor === MOCK_AMOUNTS.PROVIDER_ERROR) {
      return Promise.resolve(fail(COD_ERR.INTERNAL, 'Internal courier system error'));
    }
    if (request.cashDueMinor === MOCK_AMOUNTS.TIMEOUT) {
      return Promise.resolve(fail(COD_ERR.TIMEOUT, 'Courier system did not answer'));
    }
    const ticket = `COD-T${this.runId}-${String(++this.sequence).padStart(5, '0')}`;
    this.shipments.set(ticket, {
      cashDueMinor: request.cashDueMinor,
      collected: false,
      refundedMinor: 0,
    });
    return Promise.resolve(
      this.idempotency.remember('register', request.clientToken, { ok: true, ticket }),
    );
  }

  confirmCashCollected(request: { ticket: string }): Promise<CodResult<{ receipt: string }>> {
    const shipment = this.shipments.get(request.ticket);
    if (!shipment) return Promise.resolve(fail(COD_ERR.NOT_FOUND, 'Unknown ticket'));
    if (shipment.collected)
      return Promise.resolve(fail(COD_ERR.CONFLICT, 'Cash already collected'));
    shipment.collected = true;
    return Promise.resolve({ ok: true, receipt: `RCPT-${request.ticket}` });
  }

  refundCash(request: {
    ticket: string;
    amountMinor: number;
    clientToken?: string;
  }): Promise<CodResult<{ voucher: string }>> {
    const replayed = this.idempotency.replay<CodResult<{ voucher: string }>>(
      'refund',
      request.clientToken,
    );
    if (replayed) return Promise.resolve(replayed);

    const shipment = this.shipments.get(request.ticket);
    if (!shipment) return Promise.resolve(fail(COD_ERR.NOT_FOUND, 'Unknown ticket'));
    if (!shipment.collected)
      return Promise.resolve(fail(COD_ERR.CONFLICT, 'Cash was not collected'));
    if (shipment.cashDueMinor === MOCK_AMOUNTS.REFUND_FAILURE) {
      return Promise.resolve(fail(COD_ERR.INTERNAL, 'Internal courier system error'));
    }
    if (shipment.refundedMinor + request.amountMinor > shipment.cashDueMinor) {
      return Promise.resolve(fail(COD_ERR.CONFLICT, 'Refund exceeds collected cash'));
    }
    shipment.refundedMinor += request.amountMinor;
    return Promise.resolve(
      this.idempotency.remember('refund', request.clientToken, {
        ok: true,
        voucher: `VCH-${request.ticket}-${++this.sequence}`,
      }),
    );
  }

  /** Pentru teste: coletele pentru care s-a incasat banii. */
  collectedTickets(): readonly string[] {
    return [...this.shipments]
      .filter(([, shipment]) => shipment.collected)
      .map(([ticket]) => ticket);
  }

  /** Pentru teste: suma returnata (in unitati minore) pentru un bilet. */
  refundedMinor(ticket: string): number {
    return this.shipments.get(ticket)?.refundedMinor ?? 0;
  }
}
