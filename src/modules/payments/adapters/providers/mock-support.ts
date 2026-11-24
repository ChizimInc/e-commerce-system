import { randomBytes } from 'node:crypto';

/**
 * Sume speciale (in cenți) cu care mock-urile furnizorilor simuleaza situatii, pentru teste si demo:
 *
 * | Suma    | La autorizare                 | La rambursare |
 * | ------- | ----------------------------- | ------------- |
 * | 666.01  | card refuzat (decline)        | -             |
 * | 666.02  | eroare interna a furnizorului | -             |
 * | 666.03  | timeout (fara raspuns)        | -             |
 * | 666.04  | -                             | eroare interna|
 *
 * Orice alta suma se proceseaza cu succes. Mock-urile nu fac apeluri de retea.
 */
export const MOCK_AMOUNTS = {
  DECLINE: 66_601,
  PROVIDER_ERROR: 66_602,
  TIMEOUT: 66_603,
  REFUND_FAILURE: 66_604,
} as const;

/**
 * Sufix unic per instanta de mock: mock-urile nu isi pastreaza starea intre porniri, dar platile din baza de date
 * da (id-ul extern e unic per furnizor), deci id-urile unei porniri noi nu trebuie sa le repete pe ale celei vechi.
 */
export function newRunId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Reluarea unei operatii cu aceeasi cheie de idempotenta intoarce raspunsul dat prima oara (cum fac furnizorii reali).
 * Doar succesele se retin: un esec nu "lipeste" plata de refuz, clientul poate incerca din nou.
 */
export class IdempotencyCache {
  private readonly responses = new Map<string, unknown>();

  replay<T>(operation: string, key: string | undefined): T | undefined {
    return key === undefined
      ? undefined
      : (this.responses.get(`${operation}:${key}`) as T | undefined);
  }

  remember<T>(operation: string, key: string | undefined, response: T): T {
    if (key !== undefined) this.responses.set(`${operation}:${key}`, response);
    return response;
  }
}
