import { InvalidWebhookSignatureError } from '../../../domain/errors';
import type {
  PaymentWebhookEvent,
  WebhookHeaders,
  WebhookVerifier,
} from '../../../ports/out/WebhookVerifier';
import {
  headerValue,
  hmacSha256,
  parseJsonObject,
  requireString,
  safeEqual,
} from '../webhook-support';

/** Antetul `X-Courier-Signature`: HMAC-SHA256 hex al corpului. Folosit de teste si demo. */
export function signCourierWebhook(secret: string, body: string): string {
  return hmacSha256(secret, body, 'hex');
}

// Pattern: Abstract Factory (Creational) – produs al familiei de ramburs: verifica `X-Courier-Signature` (HMAC hex al corpului) si normalizeaza evenimentele curierului
export class CashOnDeliveryWebhookVerifier implements WebhookVerifier {
  constructor(private readonly secret: string) {}

  verify(rawBody: Buffer, headers: WebhookHeaders): PaymentWebhookEvent {
    const signature = headerValue(headers, 'x-courier-signature');
    if (!signature) throw new InvalidWebhookSignatureError();
    if (!safeEqual(signature, hmacSha256(this.secret, rawBody.toString('utf8'), 'hex'))) {
      throw new InvalidWebhookSignatureError();
    }

    const payload = parseJsonObject(rawBody);
    const eventId = requireString(payload, 'eventId');
    switch (requireString(payload, 'kind')) {
      case 'CASH_COLLECTED':
        return { eventId, kind: 'CAPTURED', externalId: requireString(payload, 'ticket') };
      case 'CASH_RETURNED':
        return { eventId, kind: 'REFUNDED', externalId: requireString(payload, 'ticket') };
      case 'DELIVERY_FAILED':
        return { eventId, kind: 'FAILED', externalId: requireString(payload, 'ticket') };
      default:
        return { eventId, kind: 'IGNORED', externalId: null };
    }
  }
}
