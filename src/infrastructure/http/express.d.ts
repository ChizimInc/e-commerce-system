import type { Principal } from '../../shared';

declare global {
  namespace Express {
    interface Request {
      /** Identitatea autentificata (setata de middleware-ul de autentificare); lipseste la cererile anonime. */
      principal?: Principal | undefined;
      /** Corpul cererii exact asa cum a fost primit (necesar pentru verificarea semnaturii webhook-urilor). */
      rawBody?: Buffer | undefined;
    }
  }
}

export {};
