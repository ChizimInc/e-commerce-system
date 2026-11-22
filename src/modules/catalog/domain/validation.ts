import { DomainError } from '../../../shared';

/** Valideaza un text obligatoriu (dupa trim) si ii intoarce forma curatata. */
export function requireText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError(`${field} nu poate fi gol`, 'VALIDATION_ERROR');
  }
  if (trimmed.length > maxLength) {
    throw new DomainError(`${field} are maximum ${maxLength} de caractere`, 'VALIDATION_ERROR');
  }
  return trimmed;
}

/** Valideaza un text optional (poate fi gol). */
export function optionalText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new DomainError(`${field} are maximum ${maxLength} de caractere`, 'VALIDATION_ERROR');
  }
  return trimmed;
}

export function requireIntegerInRange(
  value: number,
  field: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DomainError(
      `${field} trebuie sa fie un numar intreg intre ${min} si ${max}`,
      'VALIDATION_ERROR',
    );
  }
  return value;
}
