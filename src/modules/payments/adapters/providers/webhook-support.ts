import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidWebhookPayloadError } from '../../domain/errors';
import type { WebhookHeaders } from '../../ports/out/WebhookVerifier';

/** HMAC-SHA256 al unui text, in hex sau base64 (fiecare furnizor isi alege formatul semnaturii). */
export function hmacSha256(secret: string, data: string, encoding: 'hex' | 'base64'): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest(encoding);
}

/** Comparatie in timp constant (nu dezvaluie prin timp cate caractere s-au potrivit). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Valoarea unui antet (prima, daca apare de mai multe ori). */
export function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Corpul ca obiect JSON; altfel `InvalidWebhookPayloadError`. */
export function parseJsonObject(rawBody: Buffer): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new InvalidWebhookPayloadError('Corpul webhook-ului nu este JSON valid');
  }
  if (!isObject(parsed))
    throw new InvalidWebhookPayloadError('Corpul webhook-ului nu este un obiect JSON');
  return parsed;
}

/** Un camp-obiect (ex. `data.object`); `{}` daca lipseste sau are alt tip. */
export function objectAt(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  return isObject(value) ? value : {};
}

/** Un camp text obligatoriu; altfel `InvalidWebhookPayloadError`. */
export function requireString(source: JsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidWebhookPayloadError(`Campul "${key}" lipseste din corpul webhook-ului`);
  }
  return value;
}
