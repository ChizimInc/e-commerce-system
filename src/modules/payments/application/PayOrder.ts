import {
  ConflictError,
  NotFoundError,
  type Clock,
  type IdGenerator,
  type Logger,
  type Principal,
} from '../../../shared';
import { Payment } from '../domain/Payment';
import type { PaymentProvider } from '../domain/PaymentTypes';
import type { PayOrderUseCase } from '../ports/in/PaymentUseCases';
import type { PayableOrder, PayableOrders } from '../ports/out/PayableOrders';
import type { PaymentRepository } from '../ports/out/PaymentRepository';
import type { PaymentProviders } from './PaymentProviders';
import type { RefundPayment } from './RefundPayment';

/**
 * Plateste o comanda NEW prin furnizorul ales de metoda ei de plata, apoi o trece in PAID (State) si emite
 * `OrderPaid` (prin modulul `ordering`).
 *
 * Fara dubla plata, nici la cereri concurente: plata se REVENDICA inserand-o cu cheia de idempotenta unica
 * pe comanda (`pay:<orderId>`); doar cererea care a inserat-o ajunge la furnizor. O plata refuzata sau esuata se
 * poate relua (PENDING din nou, tot cu CAS); una in curs da 409; una incasata pe o comanda inca NEW se reia doar la decontare.
 */
export class PayOrder implements PayOrderUseCase {
  constructor(
    private readonly orders: PayableOrders,
    private readonly payments: PaymentRepository,
    private readonly providers: PaymentProviders,
    private readonly refunds: RefundPayment,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(principal: Principal, orderId: string): Promise<Payment> {
    const order = await this.orders.find(orderId);
    // Comanda altcuiva se raporteaza ca inexistenta (si ADMIN-ul plateste doar din contul proprietarului, nu in locul lui).
    if (!order || order.customerId !== principal.userId)
      throw new NotFoundError('Comanda', orderId);
    if (order.state === 'PAID') {
      throw new ConflictError('Comanda a fost deja platita', 'ORDER_ALREADY_PAID');
    }
    if (order.state === 'CLOSED') {
      throw new ConflictError(
        'Comanda a fost anulata si nu mai poate fi platita',
        'ORDER_NOT_PAYABLE',
      );
    }

    const services = this.providers.forMethod(order.paymentMethod);
    const { payment: claimed, resumed } = await this.claim(order, services.provider);
    // O plata deja incasata (CAPTURED) pe o comanda inca NEW nu se mai incaseaza: se reia doar decontarea comenzii.
    const captured = resumed ? claimed : await services.processor.process(claimed);
    await this.settle(order.id, captured, resumed);
    this.logger.info('Comanda platita', {
      orderId: order.id,
      paymentId: captured.id,
      provider: captured.provider,
      amount: captured.amount.toString(),
    });
    return captured;
  }

  /**
   * Inregistreaza plata PENDING; reia una esuata/refuzata; refuza (409) daca una e in curs sau comanda e platita.
   * `resumed`: plata exista deja incasata, dar comanda a ramas NEW (decontarea a esuat tranzitoriu la o cerere anterioara).
   */
  private async claim(
    order: PayableOrder,
    provider: PaymentProvider,
  ): Promise<{ payment: Payment; resumed: boolean }> {
    const fresh = Payment.start({
      id: this.ids.next(),
      orderId: order.id,
      provider,
      amount: order.total,
      now: this.clock(),
    });
    try {
      await this.payments.insert(fresh);
      return { payment: fresh, resumed: false };
    } catch (error) {
      if (!(error instanceof ConflictError) || error.code !== 'PAYMENT_EXISTS') throw error;
    }

    const existing = await this.payments.findByOrderId(order.id);
    if (!existing) throw inProgress();
    switch (existing.status) {
      case 'CAPTURED':
        return { payment: existing, resumed: true };
      case 'REFUNDING':
      case 'PENDING':
      case 'AUTHORIZED':
        throw inProgress();
      case 'REFUNDED':
        throw new ConflictError('Plata comenzii a fost rambursata', 'ORDER_ALREADY_PAID');
      case 'DECLINED':
      case 'FAILED': {
        const retried = existing.retry(this.clock());
        try {
          await this.payments.update(retried, existing.status);
        } catch (error) {
          // Alta cerere a reluat-o intre timp.
          if (error instanceof ConflictError) throw inProgress();
          throw error;
        }
        return { payment: retried, resumed: false };
      }
    }
  }

  /**
   * Trece comanda in PAID. Daca nu reuseste, comanda se RECITESTE ca sa se vada de ce:
   *  - a devenit PAID (alta cerere sau ADMIN a decontat-o, sau comiterea a reusit si raspunsul s-a pierdut): nimic de
   *    compensat; la o reluare (`resumed`) raspunsul e 409, fiindca plata a fost decontata de altcineva;
   *  - a fost inchisa (ex. anulata in timpul platii): banii incasati se returneaza imediat, clientul nu ramane taxat;
   *  - e inca NEW (esec tranzitoriu): plata ramane CAPTURED si NU se ramburseaza; o noua cerere reia doar decontarea.
   */
  private async settle(orderId: string, payment: Payment, resumed: boolean): Promise<void> {
    try {
      await this.orders.markPaid(orderId);
      return;
    } catch (error) {
      const state = (await this.orders.find(orderId).catch(() => null))?.state;
      if (state === 'PAID') {
        if (resumed) throw new ConflictError('Comanda a fost deja platita', 'ORDER_ALREADY_PAID');
        return;
      }
      if (state === 'CLOSED') await this.compensate(orderId, payment, error);
      else {
        this.logger.error(
          'Comanda nu a putut fi trecuta in PAID: plata ramane incasata, se reia la urmatoarea cerere',
          {
            orderId,
            paymentId: payment.id,
            error,
          },
        );
      }
      throw error;
    }
  }

  private async compensate(orderId: string, payment: Payment, cause: unknown): Promise<void> {
    this.logger.error('Comanda s-a inchis in timpul platii: se ramburseaza plata', {
      orderId,
      paymentId: payment.id,
      error: cause,
    });
    try {
      await this.refunds.execute(payment);
    } catch (refundError) {
      this.logger.error('Rambursarea compensatorie a esuat: e nevoie de reconciliere manuala', {
        orderId,
        paymentId: payment.id,
        provider: payment.provider,
        externalId: payment.externalId,
        error: refundError,
      });
    }
  }
}

function inProgress(): ConflictError {
  return new ConflictError('Plata comenzii este deja in curs de procesare', 'PAYMENT_IN_PROGRESS');
}
