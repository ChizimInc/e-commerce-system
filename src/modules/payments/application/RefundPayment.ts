import type { Clock, Logger } from '../../../shared';
import type { Payment } from '../domain/Payment';
import type { PaymentRepository } from '../ports/out/PaymentRepository';
import type { PaymentProviders } from './PaymentProviders';

/**
 * Ramburseaza o plata incasata, prin procesorul de rambursari al furnizorului ei.
 *
 * Idempotent si sigur la concurenta: rambursarea se REVENDICA mai intai (CAPTURED -> REFUNDING, cu concurenta
 * optimista), deci din doua procese simultane doar unul ajunge la furnizor; celalalt primeste
 * `ConflictError(PAYMENT_CHANGED)`. Daca furnizorul refuza, plata revine in CAPTURED (se poate reincerca); daca
 * rambursarea a reusit la furnizor, dar salvarea esueaza, plata ramane REFUNDING (nu se mai ramburseaza a doua oara).
 */
export class RefundPayment {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly providers: PaymentProviders,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** @param payment plata CAPTURED, asa cum e in baza de date */
  async execute(payment: Payment): Promise<Payment> {
    const claimed = payment.startRefund(this.clock());
    await this.payments.update(claimed, payment.status);

    let refundId: string;
    try {
      ({ externalId: refundId } = await this.providers
        .forProvider(payment.provider)
        .refunds.refund(claimed));
    } catch (error) {
      await this.release(claimed);
      throw error;
    }

    const refunded = claimed.refunded(refundId, this.clock());
    await this.payments.update(refunded, 'REFUNDING');
    this.logger.info('Plata rambursata', {
      paymentId: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
    });
    return refunded;
  }

  /** Rambursare refuzata de furnizor: revine in CAPTURED, ca sa poata fi reluata. */
  private async release(claimed: Payment): Promise<void> {
    try {
      await this.payments.update(claimed.rollbackRefund(this.clock()), 'REFUNDING');
    } catch (error) {
      this.logger.error('Rambursarea esuata nu a putut fi readusa in CAPTURED', {
        paymentId: claimed.id,
        orderId: claimed.orderId,
        error,
      });
    }
  }
}
