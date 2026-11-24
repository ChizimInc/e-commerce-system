import type { Payment } from '../../domain/Payment';
import { AbstractPaymentProcessor } from '../AbstractPaymentProcessor';

/** Limita Stripe: cel mult 8 cifre in unitatea minora (999.999,99). */
export const STRIPE_MAX_AMOUNT_CENTS = 99_999_999;

// Pattern: Template Method (Behavioral) – subclasa pentru Stripe (card): limita de suma si referinta "order_<id>"
export class StripePaymentProcessor extends AbstractPaymentProcessor {
  protected validate(payment: Payment): void {
    this.assertAmountAtMost(payment, STRIPE_MAX_AMOUNT_CENTS, 'Stripe');
  }

  protected reference(payment: Payment): string {
    return `order_${payment.orderId}`;
  }
}
