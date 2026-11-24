import { DomainError } from '../../../shared';

/** Text obligatoriu (dupa trim), cu lungime maxima; intoarce forma curatata. */
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
