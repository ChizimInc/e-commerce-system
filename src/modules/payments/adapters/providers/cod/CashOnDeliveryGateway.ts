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
import { COD_ERR, type CodFailure, type CourierCodApi } from './CourierCodApi';

/** Codurile numerice ale curierului, traduse in erorile portului `PaymentGateway`. */
function translate(failure: CodFailure): Error {
  if (failure.errCode === COD_ERR.REJECTED) {
    return new PaymentDeclinedError(
      'Curierul nu preia rambursul pentru aceasta comanda',
      'cod_rejected',
    );
  }
  if (failure.errCode === COD_ERR.TIMEOUT) {
    return new PaymentTimeoutError('Curierul nu a raspuns la timp');
  }
  return new PaymentProviderError(`Curier (cod ${failure.errCode}): ${failure.errText}`);
}

// Pattern: Adapter (Structural) – aduce API-ul curierului (registerCodShipment / confirmCashCollected / refundCash, raspunsuri `{ok, errCode}` fara exceptii) la portul PaymentGateway
export class CashOnDeliveryGateway implements PaymentGateway {
  constructor(private readonly api: CourierCodApi) {}

  /** "Autorizarea" rambursului = inregistrarea livrarii cu suma de incasat; biletul curierului devine id-ul extern. */
  async authorize({ reference, amount, idempotencyKey }: AuthorizeRequest): Promise<Authorization> {
    const result = await this.api.registerCodShipment({
      orderRef: reference,
      cashDueMinor: amount.amount,
      isoCurrency: amount.currency,
      clientToken: idempotencyKey,
    });
    if (!result.ok) throw translate(result);
    return { externalId: result.ticket };
  }

  /** In mock, banii se considera incasati imediat (in realitate, la livrare). */
  async capture({ externalId }: CaptureRequest): Promise<Capture> {
    const result = await this.api.confirmCashCollected({ ticket: externalId });
    if (!result.ok) throw translate(result);
    return { externalId };
  }

  async refund({ externalId, amount, idempotencyKey }: RefundRequest): Promise<Refund> {
    const result = await this.api.refundCash({
      ticket: externalId,
      amountMinor: amount.amount,
      clientToken: idempotencyKey,
    });
    if (!result.ok) throw translate(result);
    return { externalId: result.voucher };
  }
}
