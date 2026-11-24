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

const TOLERANCE_SECONDS = 300;

/** Antetele unui webhook PayPal (simulat): id, moment si HMAC-SHA256 base64 al `id|moment|corp`. Folosit de teste si demo. */
export function signPayPalWebhook(
  secret: string,
  transmission: { id: string; time: string },
  body: string,
): Record<string, string> {
  return {
    'paypal-transmission-id': transmission.id,
    'paypal-transmission-time': transmission.time,
    'paypal-transmission-sig': hmacSha256(
      secret,
      `${transmission.id}|${transmission.time}|${body}`,
      'base64',
    ),
  };
}

// Pattern: Abstract Factory (Creational) – produs al familiei PayPal: verifica antetele `paypal-transmission-*` (HMAC base64) si normalizeaza evenimentele PayPal
export class PayPalWebhookVerifier implements WebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  verify(rawBody: Buffer, headers: WebhookHeaders): PaymentWebhookEvent {
    const id = headerValue(headers, 'paypal-transmission-id');
    const time = headerValue(headers, 'paypal-transmission-time');
    const signature = headerValue(headers, 'paypal-transmission-sig');
    if (!id || !time || !signature) throw new InvalidWebhookSignatureError();

    const expected = hmacSha256(this.secret, `${id}|${time}|${rawBody.toString('utf8')}`, 'base64');
    if (!safeEqual(signature, expected)) throw new InvalidWebhookSignatureError();
    const sentAt = Date.parse(time);
    if (
      Number.isNaN(sentAt) ||
      Math.abs(this.clock().getTime() - sentAt) > TOLERANCE_SECONDS * 1000
    ) {
      throw new InvalidWebhookSignatureError('Webhook-ul este prea vechi');
    }

    const payload = parseJsonObject(rawBody);
    const eventId = requireString(payload, 'id');
    const resource = objectAt(payload, 'resource');
    switch (requireString(payload, 'event_type')) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return { eventId, kind: 'CAPTURED', externalId: requireString(resource, 'id') };
      case 'PAYMENT.CAPTURE.DENIED':
        return { eventId, kind: 'FAILED', externalId: requireString(resource, 'id') };
      case 'PAYMENT.CAPTURE.REFUNDED':
        // In mock, evenimentul de rambursare poarta id-ul capturii rambursate in `capture_id`.
        return { eventId, kind: 'REFUNDED', externalId: requireString(resource, 'capture_id') };
      default:
        return { eventId, kind: 'IGNORED', externalId: null };
    }
  }
}
