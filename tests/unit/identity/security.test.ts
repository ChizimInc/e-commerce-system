import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { BcryptPasswordHasher } from '../../../src/modules/identity/adapters/security/BcryptPasswordHasher';
import { JwtTokenService } from '../../../src/modules/identity/adapters/security/JwtTokenService';
import { uuid } from '../../helpers/ids';

const SECRET = 'a'.repeat(40);

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher(4);

  it('produce un hash bcrypt care nu contine parola', async () => {
    const hash = await hasher.hash('parola-secreta');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain('parola-secreta');
  });

  it('verifica parola corecta si o respinge pe cea gresita', async () => {
    const hash = await hasher.hash('parola-secreta');
    expect(await hasher.verify('parola-secreta', hash)).toBe(true);
    expect(await hasher.verify('alta-parola', hash)).toBe(false);
  });

  it('acelasi text da hash-uri diferite (salt aleatoriu)', async () => {
    expect(await hasher.hash('x-parola-x')).not.toBe(await hasher.hash('x-parola-x'));
  });
});

describe('JwtTokenService', () => {
  const service = new JwtTokenService(SECRET, 3600);
  const principal = { userId: uuid(1), role: 'ADMIN' as const };

  it('emite un token pe care il poate verifica inapoi', () => {
    const { token, expiresInSeconds } = service.issue(principal);
    expect(expiresInSeconds).toBe(3600);
    expect(service.verify(token)).toEqual(principal);
  });

  it('tokenul nu contine parola sau hash-ul, doar sub (id), rol, expirare', () => {
    const decoded = jwt.decode(service.issue(principal).token) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'iss', 'role', 'sub']);
  });

  it('respinge un token semnat cu alt secret', () => {
    const other = new JwtTokenService('b'.repeat(40), 3600).issue(principal).token;
    expect(service.verify(other)).toBeNull();
  });

  it('respinge un token expirat', () => {
    const expired = jwt.sign({ role: 'ADMIN' }, SECRET, {
      subject: uuid(1),
      issuer: 'e-commerce-system',
      expiresIn: -10,
    });
    expect(service.verify(expired)).toBeNull();
  });

  it('respinge un token alterat (payload modificat)', () => {
    const [header, , signature] = service
      .issue({ userId: uuid(1), role: 'CUSTOMER' })
      .token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: uuid(1), role: 'ADMIN', iss: 'e-commerce-system' }),
    ).toString('base64url');
    expect(service.verify(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it('respinge tokenurile fara semnatura (alg: none)', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: uuid(1), role: 'ADMIN' })).toString(
      'base64url',
    );
    expect(service.verify(`${header}.${payload}.`)).toBeNull();
  });

  it('respinge alt algoritm decat HS256 chiar daca semnatura e valida pentru acel algoritm', () => {
    const hs512 = jwt.sign({ role: 'ADMIN' }, SECRET, {
      algorithm: 'HS512',
      subject: uuid(1),
      issuer: 'e-commerce-system',
    });
    expect(service.verify(hs512)).toBeNull();
  });

  it('respinge alt emitent, rol necunoscut, subiect lipsa sau text oarecare', () => {
    const sign = (payload: object, options: jwt.SignOptions) => jwt.sign(payload, SECRET, options);
    expect(
      service.verify(sign({ role: 'ADMIN' }, { subject: uuid(1), issuer: 'altcineva' })),
    ).toBeNull();
    expect(
      service.verify(
        sign({ role: 'SUPERUSER' }, { subject: uuid(1), issuer: 'e-commerce-system' }),
      ),
    ).toBeNull();
    expect(service.verify(sign({ role: 'ADMIN' }, { issuer: 'e-commerce-system' }))).toBeNull();
    expect(service.verify('nu-este-un-token')).toBeNull();
    expect(service.verify('')).toBeNull();
  });
});
