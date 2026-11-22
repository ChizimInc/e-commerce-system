/**
 * Eroare de domeniu: o regula de business a fost incalcata (ex. stoc insuficient,
 * tranzitie de stare invalida). Domeniul arunca doar aceste erori; adaptoarele
 * (HTTP, CLI) decid cum se traduc (ex. 422 in REST).
 *
 * `code` este un identificator stabil, citibil de masina, util in teste si in raspunsurile API.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code = 'DOMAIN_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}
