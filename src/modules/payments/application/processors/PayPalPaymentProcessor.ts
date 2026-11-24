import type { Payment } from '../../domain/Payment';
import { AbstractPaymentProcessor } from '../AbstractPaymentProcessor';

/** Limita unei tranzactii PayPal in acest sistem: 100.000,00. */
export const PAYPAL_MAX_AMOUNT_CENTS = 10_000_000;

// Pattern: Template Method (Behavioral) – subclasa pentru PayPal: limita de suma si referinta de factura "INV-<id>"
export class PayPalPaymentProcessor extends AbstractPaymentProcessor {
  protected validate(payment: Payment): void {
    this.assertAmountAtMost(payment, PAYPAL_MAX_AMOUNT_CENTS, 'PayPal');
  }

  protected reference(payment: Payment): string {
    return `INV-${payment.orderId}`;
  }
}
