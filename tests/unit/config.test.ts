import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('aplica valorile implicite', () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('aplica valori implicite pentru JWT si bcrypt', () => {
    const config = loadConfig(valid);
    expect(config.JWT_EXPIRES_IN_SECONDS).toBe(3600);
    expect(config.BCRYPT_ROUNDS).toBe(10);
  });

  it.each([
    ['JWT_EXPIRES_IN_SECONDS', '30'],
    ['JWT_EXPIRES_IN_SECONDS', 'o-ora'],
    ['BCRYPT_ROUNDS', '3'],
    ['BCRYPT_ROUNDS', '16'],
  ])('refuza %s invalid (%s)', (name, value) => {
    expect(() => loadConfig({ ...valid, [name]: value })).toThrowError(new RegExp(name));
  });

  it('refuza in productie secretul de exemplu din .env.example', () => {
    const example = {
      ...valid,
      JWT_SECRET: 'replace-me-with-a-long-random-secret-of-32-chars-or-more',
    };
    expect(() => loadConfig({ ...example, NODE_ENV: 'production' })).toThrowError(/JWT_SECRET/);
    expect(loadConfig({ ...example, NODE_ENV: 'development' }).JWT_SECRET).toBe(example.JWT_SECRET);
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('aplica valori implicite pentru limita de cereri pe /auth', () => {
    const config = loadConfig(valid);
    expect(config.AUTH_RATE_LIMIT_MAX).toBe(30);
    expect(config.AUTH_RATE_LIMIT_WINDOW_SECONDS).toBe(900);
  });

  it('limiteaza valabilitatea tokenului la 24 de ore (tokenurile nu se pot revoca)', () => {
    expect(loadConfig({ ...valid, JWT_EXPIRES_IN_SECONDS: '86400' }).JWT_EXPIRES_IN_SECONDS).toBe(
      86_400,
    );
    expect(() => loadConfig({ ...valid, JWT_EXPIRES_IN_SECONDS: '86401' })).toThrowError(
      /JWT_EXPIRES/,
    );
  });

  it('converteste PORT din string in numar', () => {
    expect(loadConfig({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuza lipsa DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: valid.JWT_SECRET })).toThrowError(ConfigError);
  });

  it('refuza un DATABASE_URL care nu e PostgreSQL', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('refuza un JWT_SECRET prea scurt', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'scurt' })).toThrowError(/JWT_SECRET/);
  });

  it.each(['0', '70000', 'abc'])('refuza PORT invalid (%s)', (port) => {
    expect(() => loadConfig({ ...valid, PORT: port })).toThrowError(/PORT/);
  });

  it('nu include valoarea secretului in mesajul de eroare', () => {
    try {
      loadConfig({ ...valid, JWT_SECRET: 'secret-prea-scurt' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-prea-scurt');
    }
  });
});
