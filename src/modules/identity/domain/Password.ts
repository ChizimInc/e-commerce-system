import { DomainError } from '../../../shared';

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt proceseaza doar primii 72 de octeti; o parola mai lunga ar fi trunchiata in tacere. */
export const MAX_PASSWORD_BYTES = 72;

/** Politica parolelor: lungime minima si limita impusa de bcrypt (in octeti, nu in caractere). */
export function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      `Parola trebuie sa aiba cel putin ${MIN_PASSWORD_LENGTH} caractere`,
      'WEAK_PASSWORD',
    );
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    throw new DomainError(
      `Parola poate avea cel mult ${MAX_PASSWORD_BYTES} de octeti`,
      'WEAK_PASSWORD',
    );
  }
}
