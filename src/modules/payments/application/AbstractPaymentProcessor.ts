import { DomainError, type Clock, type Logger } from '../../../shared';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentRejectedError,
  PaymentTimeoutError,
} from '../domain/errors';
import type { Payment } from '../domain/Payment';
import type { PaymentGateway } from '../ports/out/PaymentGateway';
import type { PaymentRepository } from '../ports/out/PaymentRepository';

export interface PaymentProcessorDependencies {
  readonly gateway: PaymentGateway;
  readonly payments: PaymentRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Codul scurt pastrat pe plata cand procesarea esueaza (nu mesajul brut al furnizorului). */
function failureReasonOf(error: unknown): string {
  if (error instanceof PaymentDeclinedError) return error.reason;
  if (error instanceof PaymentTimeoutError) return 'provider_timeout';
  if (error instanceof PaymentProviderError) return 'provider_error';
  if (error instanceof DomainError) return error.code.toLowerCase();
  return 'unexpected_error';
}

// Pattern: Template Method (Behavioral) – scheletul `process()` = validate → authorize → capture → record este fix; pasii specifici fiecarui furnizor se suprascriu in subclase
/**
 * Procesatorul de plati: acelasi flux pentru toti furnizorii, diferă doar pasii. `process()` este
 * metoda-sablon (nu se suprascrie); subclasele ofera regulile si referinta furnizorului lor (`validate`,
 * `reference`) si pot suprascrie `authorize` / `capture` cand furnizorul cere altceva decat apelul standard.
 *
 * Primeste o plata deja REVENDICATA (PENDING, inserata de apelant cu cheia de idempotenta) si o intoarce
 * CAPTURED; la orice esec o salveaza DECLINED / FAILED si propaga eroarea.
 */
export abstract class AbstractPaymentProcessor {
  protected readonly gateway: PaymentGateway;
  protected readonly clock: Clock;
  private readonly payments: PaymentRepository;
  private readonly logger: Logger;

  constructor({ gateway, payments, clock, logger }: PaymentProcessorDependencies) {
    this.gateway = gateway;
    this.payments = payments;
    this.clock = clock;
    this.logger = logger;
  }

  /** Metoda-sablon. */
  async process(payment: Payment): Promise<Payment> {
    let current = payment;
    try {
      this.validate(current);
      current = await this.authorize(current);
      current = await this.capture(current);
    } catch (error) {
      await this.recordFailure(current, error);
      throw error;
    }
    return this.record(current);
  }

  /** Pas specific furnizorului: regulile lui (limite de suma etc.). Arunca `PaymentRejectedError`. */
  protected abstract validate(payment: Payment): void;

  /** Pas specific furnizorului: referinta trimisa la furnizor pentru aceasta plata. */
  protected abstract reference(payment: Payment): string;

  /** Rezerva suma la furnizor (hook: implicit apelul standard al gateway-ului). */
  protected async authorize(payment: Payment): Promise<Payment> {
    const { externalId } = await this.gateway.authorize({
      paymentId: payment.id,
      reference: this.reference(payment),
      amount: payment.amount,
      idempotencyKey: payment.idempotencyKey,
    });
    return payment.authorized(externalId, this.clock());
  }

  /** Incaseaza suma rezervata (hook: implicit apelul standard al gateway-ului). */
  protected async capture(payment: Payment): Promise<Payment> {
    if (payment.externalId === null) {
      throw new PaymentProviderError('Plata nu are autorizare de captat');
    }
    const { externalId } = await this.gateway.capture({
      externalId: payment.externalId,
      amount: payment.amount,
      idempotencyKey: `${payment.idempotencyKey}:capture`,
    });
    return payment.captured(externalId, this.clock());
  }

  /** Salveaza rezultatul final; `PENDING` e singura stare in care o plata se afla in baza in timpul procesarii. */
  protected async record(payment: Payment): Promise<Payment> {
    try {
      await this.payments.update(payment, 'PENDING');
    } catch (error) {
      // Banii au fost incasati, dar inregistrarea a esuat: se logheaza id-urile ca sa se poata reconcilia manual.
      this.logger.error('Plata incasata, dar nu a putut fi inregistrata', {
        paymentId: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        externalId: payment.externalId,
        error,
      });
      throw error;
    }
    return payment;
  }

  /** Marcheaza plata DECLINED (refuz al furnizorului) sau FAILED (orice alt esec); nu mascheaza eroarea originala. */
  private async recordFailure(current: Payment, error: unknown): Promise<void> {
    const now = this.clock();
    const reason = failureReasonOf(error);
    try {
      const failed =
        error instanceof PaymentDeclinedError && current.status === 'PENDING'
          ? current.declined(reason, now)
          : current.failed(reason, now);
      await this.payments.update(failed, 'PENDING');
    } catch (recordError) {
      this.logger.error('Esecul platii nu a putut fi inregistrat', {
        paymentId: current.id,
        orderId: current.orderId,
        reason,
        error: recordError,
      });
    }
  }

  /** Limita de suma a unui furnizor, in cenți (aceeasi valoare pentru toate monedele). */
  protected assertAmountAtMost(payment: Payment, maxCents: number, providerName: string): void {
    if (payment.amount.amount > maxCents) {
      throw new PaymentRejectedError(
        `Suma depaseste limita ${providerName} (${maxCents / 100})`,
        'AMOUNT_ABOVE_PROVIDER_LIMIT',
      );
    }
  }
}
