import type { Principal } from '../../shared';

declare global {
  namespace Express {
    interface Request {
      /** Identitatea autentificata (setata de middleware-ul de autentificare); lipseste la cererile anonime. */
      principal?: Principal | undefined;
    }
  }
}

export {};
