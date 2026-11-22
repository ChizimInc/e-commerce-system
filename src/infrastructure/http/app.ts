import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';
import { DomainError, type Logger } from '../../shared';
import { openApiDocument } from './openapi';

export interface AppDependencies {
  logger: Logger;
  /** Arunca daca baza de date nu raspunde. Injectat din composition root (nu importam Prisma aici). */
  checkDatabase: () => Promise<void>;
  /** Cat asteptam raspunsul bazei de date inainte sa o consideram indisponibila. */
  healthTimeoutMs?: number;
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

export function createApp({
  logger,
  checkDatabase,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
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
      res.status(422).json({ error: { code: error.code, message: error.message } });
      return;
    }
    logger.error('Eroare neasteptata', { error, method: req.method, path: req.path });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Eroare interna' } });
  });

  return app;
}
