import type { Principal } from '../../../../shared';

export interface IssuedToken {
  readonly token: string;
  readonly expiresInSeconds: number;
}

/** Port de iesire: emiterea si verificarea tokenurilor de acces (adaptor: JWT). */
export interface TokenService {
  issue(principal: Principal): IssuedToken;
  /** Intoarce identitatea din token, sau `null` daca tokenul e invalid, expirat sau alterat. */
  verify(token: string): Principal | null;
}
