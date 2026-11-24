import type { Payment } from '../../domain/Payment';
import { AbstractPaymentProcessor } from '../AbstractPaymentProcessor';

/** Curierii nu preiau ramburs peste 5.000,00 per colet. */
export const COD_MAX_AMOUNT_CENTS = 500_000;

// Pattern: Template Method (Behavioral) – subclasa pentru ramburs: plafon mic de suma si referinta "COD-<id>"
export class CashOnDeliveryPaymentProcessor extends AbstractPaymentProcessor {
  protected validate(payment: Payment): void {
    this.assertAmountAtMost(payment, COD_MAX_AMOUNT_CENTS, 'rambursului');
  }

  protected reference(payment: Payment): string {
    return `COD-${payment.orderId}`;
  }
}
