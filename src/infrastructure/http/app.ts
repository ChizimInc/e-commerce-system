import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  type Logger,
} from '../../shared';
import { openApiDocument } from './openapi';

export interface AppDependencies {
  logger: Logger;
  /** Arunca daca baza de date nu raspunde. Injectat din composition root (nu importam Prisma aici). */
  checkDatabase: () => Promise<void>;
  /** Cat asteptam raspunsul bazei de date inainte sa o consideram indisponibila. */
  healthTimeoutMs?: number;
  /** Middleware-uri globale (ex. autentificarea), aplicate inaintea rutelor modulelor. */
  middlewares?: readonly RequestHandler[];
  /** Routerele modulelor (catalog, cart etc.), montate la radacina. */
  routers?: readonly Router[];
}

const DEFAULT_HEALTH_TIMEOUT_MS = 3000;

async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout dupa ${ms} ms`)), ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Traducerea erorilor de domeniu in coduri HTTP (domeniul nu stie de HTTP). */
function statusOf(error: DomainError): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof TooManyRequestsError) return 429;
  return 422;
}

const DEFAULT_CLIENT_ERROR = { code: 'BAD_REQUEST', message: 'Cerere invalida' };
const CLIENT_ERRORS: Record<number, { code: string; message: string }> = {
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Corpul cererii este prea mare' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tip de continut sau charset nesuportat' },
};

/** Statusul 4xx al unei erori produse de middleware-uri (body-parser etc.), daca are unul. */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = error.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export function createApp({
  logger,
  checkDatabase,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  middlewares = [],
  routers = [],
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', async (_req: Request, res: Response) => {
    let database: 'up' | 'down' = 'up';
    try {
      await withTimeout(checkDatabase(), healthTimeoutMs);
    } catch (error) {
      database = 'down';
      logger.error('Health check: baza de date indisponibila', { error });
    }
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
      uptimeSeconds: Math.round(process.uptime() * 10) / 10,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  // `app.use()` cu zero argumente arunca eroare, deci montam doar cand exista ceva de montat.
  if (middlewares.length > 0) app.use(...middlewares);
  if (routers.length > 0) app.use(...routers);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta inexistenta' } });
  });

  // Handler central de erori (Express 5 il apeleaza si pentru erori din handlere async).
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Date de intrare invalide',
          details: error.issues,
        },
      });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      // JSON malformat in corpul cererii (aruncat de express.json()).
      res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Corpul cererii nu este JSON valid' } });
      return;
    }
    if (error instanceof DomainError) {
      if (error instanceof UnauthorizedError) res.set('WWW-Authenticate', 'Bearer');
      res.status(statusOf(error)).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== undefined) {
      // Erori 4xx ale middleware-urilor Express (ex. corp prea mare, charset nesuportat): nu sunt defecte ale serverului.
      res.status(clientStatus).json({ error: CLIENT_ERRORS[clientStatus] ?? DEFAULT_CLIENT_ERROR });
      return;
    }
    logger.error('Eroare neasteptata', { error, method: req.method, path: req.path });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Eroare interna' } });
  });

  return app;
}
