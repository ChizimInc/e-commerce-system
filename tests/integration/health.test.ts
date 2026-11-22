import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/infrastructure/http/app';
import { ConsoleLogger } from '../../src/shared';

const silentLogger = new ConsoleLogger('error', {}, () => undefined);

describe('GET /health', () => {
  it('raspunde 200 cand baza de date e disponibila', async () => {
    const app = createApp({ logger: silentLogger, checkDatabase: () => Promise.resolve() });
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('raspunde 503 cand baza de date da eroare', async () => {
    const app = createApp({
      logger: silentLogger,
      checkDatabase: () => Promise.reject(new Error('connection refused')),
    });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'error', checks: { database: 'down' } });
  });

  it('raspunde 503 cand baza de date nu raspunde in timp util', async () => {
    const app = createApp({
      logger: silentLogger,
      checkDatabase: () => new Promise(() => undefined),
      healthTimeoutMs: 20,
    });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
  });
});

describe('restul aplicatiei', () => {
  const app = createApp({ logger: silentLogger, checkDatabase: () => Promise.resolve() });

  it('serveste Swagger UI la /docs/', async () => {
    const response = await request(app).get('/docs/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });

  it('raspunde 400 pentru JSON malformat', async () => {
    const response = await request(app)
      .post('/orice')
      .set('Content-Type', 'application/json')
      .send('{nu e json');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_JSON' } });
  });

  it('raspunde 404 JSON pentru rute necunoscute', async () => {
    const response = await request(app).get('/nu-exista');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
