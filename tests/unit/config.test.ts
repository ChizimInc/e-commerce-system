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
