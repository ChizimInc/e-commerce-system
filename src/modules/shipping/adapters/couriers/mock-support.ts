import { randomBytes } from 'node:crypto';

/**
 * Situatii cu care mock-urile curierilor simuleaza esecuri, pentru teste si demo. Se declanseaza dupa codul postal al
 * adresei (ex. in curl) sau dupa valoarea declarata a coletului (totalul comenzii, in cenți):
 *
 * | Cod postal | Valoare declarata | La preluarea coletului            |
 * | ---------- | ----------------- | --------------------------------- |
 * | `00000`    | 777.01            | adresa nelivrabila (refuz)        |
 * | `00001`    | 777.02            | eroare interna a curierului       |
 * | `00002`    | 777.03            | timeout (fara raspuns)            |
 *
 * Orice alta adresa sau valoare se proceseaza cu succes. Mock-urile nu fac apeluri de retea.
 */
export const MOCK_TRIGGERS = {
  REJECT_POSTAL_CODE: '00000',
  ERROR_POSTAL_CODE: '00001',
  TIMEOUT_POSTAL_CODE: '00002',
  REJECT_VALUE: 77_701,
  ERROR_VALUE: 77_702,
  TIMEOUT_VALUE: 77_703,
} as const;

export type SimulatedFailure = 'reject' | 'error' | 'timeout';

/** Ce esec (daca vreunul) cere adresa sau valoarea unui colet. */
export function simulatedFailureFor(
  postalCode: string,
  declaredValueCents: number,
): SimulatedFailure | null {
  const code = postalCode.trim();
  if (
    code === MOCK_TRIGGERS.REJECT_POSTAL_CODE ||
    declaredValueCents === MOCK_TRIGGERS.REJECT_VALUE
  ) {
    return 'reject';
  }
  if (
    code === MOCK_TRIGGERS.ERROR_POSTAL_CODE ||
    declaredValueCents === MOCK_TRIGGERS.ERROR_VALUE
  ) {
    return 'error';
  }
  if (
    code === MOCK_TRIGGERS.TIMEOUT_POSTAL_CODE ||
    declaredValueCents === MOCK_TRIGGERS.TIMEOUT_VALUE
  ) {
    return 'timeout';
  }
  return null;
}

/**
 * Sufix unic per instanta de mock: mock-urile nu isi pastreaza starea intre porniri, dar livrarile din baza de date
 * da (id-ul extern e unic per curier), deci id-urile unei porniri noi nu trebuie sa le repete pe ale celei vechi.
 */
export function newRunId(): string {
  return randomBytes(4).toString('hex');
}

/** Cat dureaza un colet pana la fiecare etapa, de la preluare; testele le pot scurta sau lungi. */
export interface TransitTimes {
  /** Dupa cat timp pleaca in tranzit. */
  readonly inTransitAfterMs: number;
  /** Dupa cat timp ajunge la destinatar. */
  readonly deliveredAfterMs: number;
}

/**
 * Reluarea unei preluari cu aceeasi cheie de idempotenta intoarce raspunsul dat prima oara (cum fac curierii reali).
 * Doar succesele se retin: un esec nu "lipeste" coletul de refuz, administratorul poate incerca din nou.
 */
export class IdempotencyCache {
  private readonly responses = new Map<string, unknown>();

  replay<T>(key: string | undefined): T | undefined {
    return key === undefined ? undefined : (this.responses.get(key) as T | undefined);
  }

  remember<T>(key: string | undefined, response: T): T {
    if (key !== undefined) this.responses.set(key, response);
    return response;
  }
}
