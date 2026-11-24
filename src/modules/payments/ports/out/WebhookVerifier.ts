/** Antetele HTTP ale webhook-ului, cu numele in litere mici (cum le expune Node). */
export type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** Ce s-a intamplat la furnizor, in vocabularul nostru (fiecare furnizor isi are propriile nume de evenimente). */
export type WebhookEventKind = 'CAPTURED' | 'REFUNDED' | 'FAILED' | 'IGNORED';

export interface PaymentWebhookEvent {
  /** Id-ul evenimentului la furnizor (el reincearca livrarea, deci ar putea veni de mai multe ori). */
  readonly eventId: string;
  readonly kind: WebhookEventKind;
  /** Id-ul tranzactiei la furnizor (cel salvat pe plata); `null` pentru evenimente ignorate. */
  readonly externalId: string | null;
}

/**
 * Port de iesire (parte din familia unui furnizor): verifica semnatura unui webhook si il normalizeaza.
 * Fiecare furnizor isi semneaza altfel mesajele, deci verificatorul face parte din familia lui.
 */
export interface WebhookVerifier {
  /**
   * @param rawBody corpul exact asa cum a fost primit (semnatura se calculeaza pe octetii originali)
   * @throws InvalidWebhookSignatureError semnatura lipseste, e gresita sau mesajul e prea vechi
   * @throws InvalidWebhookPayloadError semnatura e corecta, dar corpul nu are formatul furnizorului
   */
  verify(rawBody: Buffer, headers: WebhookHeaders): PaymentWebhookEvent;
}
