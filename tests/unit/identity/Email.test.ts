import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/shared';
import { Email } from '../../../src/modules/identity/domain/Email';
import { assertValidPassword } from '../../../src/modules/identity/domain/Password';

describe('Email', () => {
  it('normalizeaza: fara spatii, litere mici', () => {
    expect(Email.of('  Ana.Pop@Example.COM ').value).toBe('ana.pop@example.com');
  });

  it('doua adrese care difera doar prin litere mari sunt egale', () => {
    expect(Email.of('A@b.ro').equals(Email.of('a@B.RO'))).toBe(true);
  });

  it.each(['', 'fara-arond', '@b.ro', 'a@b', 'a b@c.ro', `${'x'.repeat(250)}@b.ro`])(
    'refuza adresa invalida %j',
    (raw) => {
      expect(() => Email.of(raw)).toThrowError(DomainError);
    },
  );
});

describe('politica parolelor', () => {
  it('accepta o parola de 8 caractere', () => {
    expect(() => assertValidPassword('12345678')).not.toThrow();
  });

  it('refuza parolele prea scurte', () => {
    expect(() => assertValidPassword('1234567')).toThrowError(/cel putin 8/);
  });

  it('limita de 72 se aplica in octeti, nu in caractere (bcrypt)', () => {
    expect(() => assertValidPassword('a'.repeat(72))).not.toThrow();
    expect(() => assertValidPassword('a'.repeat(73))).toThrowError(/72 de octeti/);
    // 40 de caractere "ă" = 80 de octeti in UTF-8
    expect(() => assertValidPassword('ă'.repeat(40))).toThrowError(/72 de octeti/);
  });
});
