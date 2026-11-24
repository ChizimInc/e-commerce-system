import type { Principal } from '../../../../shared';
import type { Payment } from '../../domain/Payment';
import type { PaymentProvider, PaymentStatus } from '../../domain/PaymentTypes';
import type { WebhookHeaders } from '../out/WebhookVerifier';

/** Port de intrare: plata unei comenzi. */
export interface PayOrderUseCase {
  /**
   * Plateste o comanda NEW prin furnizorul ales de metoda ei de plata si o trece in PAID.
   * Doar proprietarul comenzii (altfel `NotFoundError`). O comanda nu se plateste de doua ori (`ConflictError`).
   */
  execute(principal: Principal, orderId: string): Promise<Payment>;
}

/** Port de intrare: starea platii unei comenzi. */
export interface GetOrderPaymentUseCase {
  /** Proprietarul comenzii sau ADMIN; `NotFoundError` daca comanda nu e a ta sau nu are plata. */
  execute(principal: Principal, orderId: string): Promise<Payment>;
}

export interface WebhookOutcome {
  /** Evenimentul se refera la o plata cunoscuta. */
  readonly matched: boolean;
  /** Starea platii noastre (daca exista), ca furnizorul sa poata compara. */
  readonly paymentStatus: PaymentStatus | null;
}

/** Port de intrare: webhook-urile furnizorilor (confirmari asincrone). */
export interface PaymentWebhookUseCase {
  /** Verifica semnatura (altfel `InvalidWebhookSignatureError`) si reconciliaza evenimentul cu plata noastra. */
  handle(
    provider: PaymentProvider,
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<WebhookOutcome>;
}
