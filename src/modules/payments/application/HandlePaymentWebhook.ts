import type { Logger } from '../../../shared';
import type { PaymentProvider, PaymentStatus } from '../domain/PaymentTypes';
import type { PaymentWebhookUseCase, WebhookOutcome } from '../ports/in/PaymentUseCases';
import type { PaymentRepository } from '../ports/out/PaymentRepository';
import type { WebhookEventKind, WebhookHeaders } from '../ports/out/WebhookVerifier';
import type { PaymentProviders } from './PaymentProviders';

/** Starile platii noastre cu care se potriveste fiecare tip de eveniment de la furnizor. */
const CONSISTENT_STATUSES: Record<
  Exclude<WebhookEventKind, 'IGNORED'>,
  readonly PaymentStatus[]
> = {
  CAPTURED: ['CAPTURED', 'REFUNDING', 'REFUNDED'],
  REFUNDED: ['REFUNDING', 'REFUNDED'],
  FAILED: ['DECLINED', 'FAILED'],
};

/**
 * Primeste webhook-urile furnizorilor: verificatorul din familia furnizorului (WebhookVerifier) valideaza semnatura
 * si normalizeaza evenimentul, iar aici se reconciliaza cu plata noastra. Webhook-ul NU modifica starea platii
 * (sursa de adevar e raspunsul sincron al gateway-ului); o nepotrivire se logheaza ca avertisment. Fiind doar
 * citire + log, e idempotent: furnizorul isi poate reincerca livrarea oricat.
 */
export class HandlePaymentWebhook implements PaymentWebhookUseCase {
  constructor(
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentRepository,
    private readonly logger: Logger,
  ) {}

  async handle(
    provider: PaymentProvider,
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<WebhookOutcome> {
    const event = this.providers.forProvider(provider).webhooks.verify(rawBody, headers);
    if (event.kind === 'IGNORED' || event.externalId === null) {
      return { matched: false, paymentStatus: null };
    }

    const payment = await this.payments.findByExternalId(provider, event.externalId);
    if (!payment) {
      this.logger.warn('Webhook pentru o plata necunoscuta', {
        provider,
        eventId: event.eventId,
        kind: event.kind,
      });
      return { matched: false, paymentStatus: null };
    }
    if (!CONSISTENT_STATUSES[event.kind].includes(payment.status)) {
      this.logger.warn('Webhook in dezacord cu starea platii noastre', {
        provider,
        eventId: event.eventId,
        kind: event.kind,
        paymentId: payment.id,
        paymentStatus: payment.status,
      });
    }
    return { matched: true, paymentStatus: payment.status };
  }
}
