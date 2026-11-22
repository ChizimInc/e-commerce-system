import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loginResponseSchema,
  userResponseSchema,
} from '../../src/modules/identity/adapters/http/auth.schemas';
import { Email } from '../../src/modules/identity/domain/Email';
import { TEST_JWT_SECRET, TEST_PASSWORD, bearer, buildTestApp, type TestApp } from '../helpers/app';

const registration = { email: 'ana@example.com', password: TEST_PASSWORD };

describe('POST /auth/register', () => {
  let ctx: TestApp;
  beforeEach(() => {
    ctx = buildTestApp();
  });

  it('creeaza un cont CUSTOMER si nu intoarce parola sau hash-ul', async () => {
    const response = await request(ctx.app).post('/auth/register').send(registration);
    expect(response.status).toBe(201);
    const user = userResponseSchema.parse(response.body);
    expect(user).toMatchObject({ email: 'ana@example.com', role: 'CUSTOMER' });
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  it('parola se stocheaza hash-uita cu bcrypt', async () => {
    await request(ctx.app).post('/auth/register').send(registration);
    const stored = await ctx.repositories.users.findByEmail(Email.of('ana@example.com'));
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('refuza rolul trimis in corp: nu te poti inregistra ca ADMIN (400)', async () => {
    const response = await request(ctx.app)
      .post('/auth/register')
      .send({ ...registration, role: 'ADMIN' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect((await request(ctx.app).post('/auth/login').send(registration)).status).toBe(401);
  });

  it('refuza emailul duplicat (409), inclusiv cu alte litere mari/mici', async () => {
    await request(ctx.app).post('/auth/register').send(registration);
    const response = await request(ctx.app)
      .post('/auth/register')
      .send({ ...registration, email: 'ANA@Example.com' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'EMAIL_TAKEN' } });
  });

  it.each([
    ['email invalid', { email: 'nu-e-email', password: TEST_PASSWORD }],
    ['email lipsa', { password: TEST_PASSWORD }],
    ['parola scurta', { email: 'a@b.ro', password: 'scurta' }],
    ['parola prea lunga (73 de octeti)', { email: 'a@b.ro', password: 'a'.repeat(73) }],
    ['parola nu e text', { email: 'a@b.ro', password: 12345678 }],
    ['corp gol', {}],
  ])('raspunde 400 la %s', async (_label, body) => {
    const response = await request(ctx.app).post('/auth/register').send(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('POST /auth/login', () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = buildTestApp();
    await request(ctx.app).post('/auth/register').send(registration);
  });

  it('intoarce un JWT Bearer si profilul, fara cache', async () => {
    const response = await request(ctx.app).post('/auth/login').send(registration);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = loginResponseSchema.parse(response.body);
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    const payload = jwt.verify(body.accessToken, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(payload).toMatchObject({ sub: body.user.id, role: 'CUSTOMER' });
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash/i);
  });

  it('parola gresita si emailul necunoscut dau acelasi 401', async () => {
    const wrongPassword = await request(ctx.app)
      .post('/auth/login')
      .send({ ...registration, password: 'gresita-gresita' });
    const unknown = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'nimeni@example.com', password: TEST_PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['fara parola', { email: registration.email }],
    ['camp necunoscut', { ...registration, extra: 1 }],
    ['parola goala', { email: registration.email, password: '' }],
  ])('raspunde 400 %s', async (_label, body) => {
    expect((await request(ctx.app).post('/auth/login').send(body)).status).toBe(400);
  });
});

describe('GET /auth/me si autentificarea cu Bearer', () => {
  let ctx: TestApp;
  beforeEach(() => {
    ctx = buildTestApp();
  });

  it('intoarce profilul utilizatorului din token', async () => {
    const token = await ctx.customerToken('ana@example.com');
    const response = await request(ctx.app)
      .get('/auth/me')
      .set(...bearer(token));
    expect(response.status).toBe(200);
    expect(userResponseSchema.parse(response.body)).toMatchObject({
      email: 'ana@example.com',
      role: 'CUSTOMER',
    });
  });

  it('401 fara token', async () => {
    const response = await request(ctx.app).get('/auth/me');
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['token fara schema Bearer', (t: string) => t],
    ['schema gresita', (t: string) => `Basic ${t}`],
    ['token gol', () => 'Bearer '],
    ['token inventat', () => 'Bearer abc.def.ghi'],
  ])('401 pentru %s', async (_label, header) => {
    const token = await ctx.customerToken();
    const response = await request(ctx.app).get('/auth/me').set('Authorization', header(token));
    expect(response.status).toBe(401);
  });

  it('401 pentru token expirat sau semnat cu alt secret', async () => {
    const token = await ctx.customerToken('ana@example.com');
    const { sub } = jwt.decode(token) as jwt.JwtPayload;
    const claims = { subject: String(sub), issuer: 'e-commerce-system' };
    const expired = jwt.sign({ role: 'CUSTOMER' }, TEST_JWT_SECRET, { ...claims, expiresIn: -5 });
    const forged = jwt.sign({ role: 'ADMIN' }, 'alt-secret-alt-secret-alt-secret-12345', claims);
    for (const bad of [expired, forged]) {
      const response = await request(ctx.app)
        .get('/auth/me')
        .set(...bearer(bad));
      expect(response.status).toBe(401);
    }
  });

  it('un token valid pentru un utilizator sters nu mai da acces la profil (404)', async () => {
    const orphan = jwt.sign({ role: 'CUSTOMER' }, TEST_JWT_SECRET, {
      subject: '00000000-0000-4000-8000-0000000000ee',
      issuer: 'e-commerce-system',
    });
    const response = await request(ctx.app)
      .get('/auth/me')
      .set(...bearer(orphan));
    expect(response.status).toBe(404);
  });
});
