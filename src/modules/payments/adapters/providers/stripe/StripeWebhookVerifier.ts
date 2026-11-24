import type { Clock } from '../../../../../shared';
import { InvalidWebhookSignatureError } from '../../../domain/errors';
import type {
  PaymentWebhookEvent,
  WebhookHeaders,
  WebhookVerifier,
} from '../../../ports/out/WebhookVerifier';
import {
  headerValue,
  hmacSha256,
  objectAt,
  parseJsonObject,
  requireString,
  safeEqual,
} from '../webhook-support';

/** Cat de veche poate fi o semnatura (protectie la reluari), ca la Stripe. */
const TOLERANCE_SECONDS = 300;

/** Antetul `Stripe-Signature` pentru un corp: `t=<secunde>,v1=<hmac-sha256-hex al "t.corp">`. Folosit de mock si de teste. */
export function signStripeWebhook(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${hmacSha256(secret, `${timestampSeconds}.${body}`, 'hex')}`;
}

// Pattern: Abstract Factory (Creational) – produs al familiei Stripe: verifica antetul `Stripe-Signature` (t=...,v1=HMAC) si normalizeaza evenimentele Stripe
export class StripeWebhookVerifier implements WebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  verify(rawBody: Buffer, headers: WebhookHeaders): PaymentWebhookEvent {
    const header = headerValue(headers, 'stripe-signature');
    if (!header) throw new InvalidWebhookSignatureError();

    const fields = header.split(',').map((part) => part.trim().split('=', 2) as [string, string?]);
    const timestamp = fields.find(([key]) => key === 't')?.[1];
    const signatures = fields.flatMap(([key, value]) => (key === 'v1' && value ? [value] : []));
    if (timestamp === undefined || !/^\d{1,12}$/.test(timestamp))
      throw new InvalidWebhookSignatureError();

    const expected = hmacSha256(this.secret, `${timestamp}.${rawBody.toString('utf8')}`, 'hex');
    if (!signatures.some((signature) => safeEqual(signature, expected))) {
      throw new InvalidWebhookSignatureError();
    }
    if (Math.abs(this.clock().getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) {
      throw new InvalidWebhookSignatureError('Webhook-ul este prea vechi');
    }

    const payload = parseJsonObject(rawBody);
    const eventId = requireString(payload, 'id');
    const object = objectAt(objectAt(payload, 'data'), 'object');
    switch (requireString(payload, 'type')) {
      case 'payment_intent.succeeded':
        return { eventId, kind: 'CAPTURED', externalId: requireString(object, 'id') };
      case 'payment_intent.payment_failed':
        return { eventId, kind: 'FAILED', externalId: requireString(object, 'id') };
      case 'charge.refunded':
        return { eventId, kind: 'REFUNDED', externalId: requireString(object, 'payment_intent') };
      default:
        return { eventId, kind: 'IGNORED', externalId: null };
    }
  }
}
