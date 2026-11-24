import type { Clock } from '../../../../../shared';
import { GatewayRefundProcessor } from '../../../application/GatewayRefundProcessor';
import { PaymentRejectedError } from '../../../domain/errors';
import type { Payment } from '../../../domain/Payment';
import type { PaymentGateway, Refund } from '../../../ports/out/PaymentGateway';

/** PayPal nu mai ramburseaza o captura mai veche de 180 de zile. */
export const PAYPAL_REFUND_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pattern: Abstract Factory (Creational) – produs al familiei PayPal: rambursarea standard + fereastra de 180 de zile impusa de PayPal
export class PayPalRefundProcessor extends GatewayRefundProcessor {
  constructor(
    gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {
    super(gateway);
  }

  override async refund(payment: Payment): Promise<Refund> {
    const ageMs = this.clock().getTime() - payment.createdAt.getTime();
    if (ageMs > PAYPAL_REFUND_WINDOW_DAYS * DAY_MS) {
      throw new PaymentRejectedError(
        `PayPal nu mai ramburseaza plati mai vechi de ${PAYPAL_REFUND_WINDOW_DAYS} de zile`,
        'REFUND_WINDOW_EXPIRED',
      );
    }
    return super.refund(payment);
  }
}
