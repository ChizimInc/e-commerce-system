import { DomainError } from './DomainError';

/**
 * Subtipuri de DomainError cu semantica clara. Domeniul si aplicatia le arunca fara sa stie de HTTP;
 * adaptorul REST le traduce in 404 / 409 / 401 / 403 (vezi infrastructure/http/app.ts).
 */

/** Resursa ceruta nu exista. */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} inexistent: ${id}`, 'NOT_FOUND');
  }
}

/** Operatia intra in conflict cu starea curenta (duplicat, stoc insuficient, resursa folosita). */
export class ConflictError extends DomainError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code);
  }
}

/** Apelantul nu este autentificat (lipseste sau e invalid tokenul / credentialele). */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Autentificare necesara') {
    super(message, 'UNAUTHORIZED');
  }
}

/** Apelantul este autentificat, dar nu are rolul necesar. */
export class ForbiddenError extends DomainError {
  constructor(message = 'Nu ai dreptul sa efectuezi aceasta operatie') {
    super(message, 'FORBIDDEN');
  }
}
