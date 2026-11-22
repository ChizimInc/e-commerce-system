import 'dotenv/config';
import { loadConfig } from './config';
import { createContainer } from './composition-root';

function main(): void {
  const config = loadConfig();
  const { app, logger, shutdown } = createContainer(config);

  const server = app.listen(config.PORT, () => {
    logger.info('Server pornit', {
      port: config.PORT,
      health: `http://localhost:${config.PORT}/health`,
      docs: `http://localhost:${config.PORT}/docs`,
    });
  });

  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Oprire server', { signal });
    server.close(() => {
      shutdown()
        .catch((error: unknown) => logger.error('Eroare la oprire', { error }))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

try {
  main();
} catch (error) {
  // Configurarea invalida opreste pornirea cu un mesaj clar (fara stack trace zgomotos).
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
