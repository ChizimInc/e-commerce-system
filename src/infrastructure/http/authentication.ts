import type { Request, RequestHandler } from 'express';
import type { TokenService } from '../../modules/identity/ports/out/TokenService';
import { ForbiddenError, UnauthorizedError, type Principal, type Role } from '../../shared';

export interface Authentication {
  /**
   * Middleware global: daca cererea are `Authorization: Bearer <token>`, verifica tokenul si
   * seteaza `req.principal`; un token prezent dar invalid da 401. Cererile fara antet raman anonime.
   */
  readonly authenticate: RequestHandler;
  /** Cere o identitate autentificata (401 altfel). */
  readonly requireAuth: RequestHandler;
  /** Cere un rol anume: 401 fara autentificare, 403 cu alt rol. */
  readonly requireRole: (role: Role) => RequestHandler;
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function createAuthentication(tokens: TokenService): Authentication {
  const authenticate: RequestHandler = (req, _res, next) => {
    const header = req.header('authorization');
    if (header === undefined) {
      next();
      return;
    }
    const token = BEARER_PATTERN.exec(header)?.[1];
    const principal = token === undefined ? null : tokens.verify(token);
    if (!principal) {
      next(new UnauthorizedError('Token de acces lipsa, invalid sau expirat'));
      return;
    }
    req.principal = principal;
    next();
  };

  const requireAuth: RequestHandler = (req, _res, next) => {
    next(req.principal ? undefined : new UnauthorizedError());
  };

  const requireRole =
    (role: Role): RequestHandler =>
    (req, _res, next) => {
      if (!req.principal) {
        next(new UnauthorizedError());
      } else if (req.principal.role !== role) {
        next(new ForbiddenError());
      } else {
        next();
      }
    };

  return { authenticate, requireAuth, requireRole };
}

/** Identitatea cererii curente; arunca 401 daca ruta a fost montata fara `requireAuth`. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw new UnauthorizedError();
  return req.principal;
}
