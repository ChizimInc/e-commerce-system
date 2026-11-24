import { PaymentRejectedError } from '../domain/errors';
import type { Payment } from '../domain/Payment';
import type { PaymentGateway, Refund } from '../ports/out/PaymentGateway';
import type { RefundProcessor } from '../ports/out/RefundProcessor';

/**
 * Rambursarea standard: intreaga suma captata, prin gateway-ul furnizorului. Cheia de idempotenta e legata de
 * plata, deci o reluare (ex. dupa un timeout) nu returneaza banii de doua ori la furnizorii care o respecta.
 * Furnizorii cu reguli proprii (ex. `PayPalRefundProcessor`) o extind.
 */
export class GatewayRefundProcessor implements RefundProcessor {
  constructor(protected readonly gateway: PaymentGateway) {}

  async refund(payment: Payment): Promise<Refund> {
    if (payment.status !== 'REFUNDING' || payment.externalId === null) {
      throw new PaymentRejectedError(
        `Plata ${payment.status} nu poate fi rambursata`,
        'PAYMENT_NOT_REFUNDABLE',
      );
    }
    return this.gateway.refund({
      externalId: payment.externalId,
      amount: payment.amount,
      idempotencyKey: `refund:${payment.id}`,
    });
  }
}
