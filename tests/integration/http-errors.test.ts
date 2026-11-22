import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app';

/** Erorile 4xx ale parser-ului de corp trebuie sa ajunga la client ca 4xx, nu sa devina 500. */
describe('erori HTTP ale cererii', () => {
  const { app } = buildTestApp();

  it('413 pentru un corp JSON mai mare decat limita', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.ro', password: 'x'.repeat(200_000) }));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('415 pentru un charset nesuportat', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json; charset=x-nu-exista')
      .send('{}');
    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
  });

  it('400 pentru JSON malformat (neschimbat)', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{nu e json');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_JSON' } });
  });

  it('un corp care nu e JSON este tratat ca lipsa de date (400 de validare, nu 500)', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=a@b.ro');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
