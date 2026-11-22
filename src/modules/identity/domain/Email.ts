import { DomainError } from '../../../shared';

const MAX_EMAIL_LENGTH = 254;
// Verificare pragmatica de forma (nu RFC complet): ceva@domeniu.tld, fara spatii.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Value object: adresa de email normalizata (fara spatii, litere mici) si validata. */
export class Email {
  private constructor(readonly value: string) {}

  static of(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalized)) {
      throw new DomainError('Adresa de email este invalida', 'INVALID_EMAIL');
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
