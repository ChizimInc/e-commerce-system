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

/** Apelantul este autentificat, dar nu are rolul necesar (sau, cu alt `code`, nu are dreptul la operatia ceruta). */
export class ForbiddenError extends DomainError {
  constructor(message = 'Nu ai dreptul sa efectuezi aceasta operatie', code = 'FORBIDDEN') {
    super(message, code);
  }
}

/** Prea multe cereri/operatii intr-un interval scurt (limitare de frecventa). */
export class TooManyRequestsError extends DomainError {
  constructor(message: string, code = 'TOO_MANY_REQUESTS') {
    super(message, code);
  }
}

/** Un serviciu extern (ex. furnizor de plati) a raspuns cu o eroare sau cu un raspuns de neinteles. */
export class BadGatewayError extends DomainError {
  constructor(message: string, code = 'BAD_GATEWAY', options?: ErrorOptions) {
    super(message, code, options);
  }
}

/** Un serviciu extern nu a raspuns la timp. */
export class GatewayTimeoutError extends DomainError {
  constructor(message: string, code = 'GATEWAY_TIMEOUT', options?: ErrorOptions) {
    super(message, code, options);
  }
}
