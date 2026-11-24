import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_SECRET: 'a'.repeat(32),
  PAYMENT_WEBHOOK_SECRET: 'b'.repeat(16),
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

  describe('PAYMENT_WEBHOOK_SECRET (secretul webhook-urilor de plata)', () => {
    it('este obligatoriu', () => {
      const withoutSecret: Record<string, string> = { ...valid };
      delete withoutSecret['PAYMENT_WEBHOOK_SECRET'];
      expect(() => loadConfig(withoutSecret)).toThrowError(/PAYMENT_WEBHOOK_SECRET/);
    });

    it('are cel putin 16 caractere', () => {
      expect(() => loadConfig({ ...valid, PAYMENT_WEBHOOK_SECRET: 'a'.repeat(15) })).toThrowError(
        /PAYMENT_WEBHOOK_SECRET/,
      );
      expect(
        loadConfig({ ...valid, PAYMENT_WEBHOOK_SECRET: 'a'.repeat(16) }).PAYMENT_WEBHOOK_SECRET,
      ).toBe('a'.repeat(16));
    });

    it('valoarea de exemplu din .env.example nu e permisa in productie (dar merge in dezvoltare)', () => {
      const example = {
        ...valid,
        PAYMENT_WEBHOOK_SECRET: 'replace-me-with-a-random-webhook-secret',
      };
      expect(() => loadConfig({ ...example, NODE_ENV: 'production' })).toThrowError(
        /PAYMENT_WEBHOOK_SECRET/,
      );
      expect(loadConfig({ ...example, NODE_ENV: 'development' }).PAYMENT_WEBHOOK_SECRET).toBe(
        example.PAYMENT_WEBHOOK_SECRET,
      );
    });

    it('mesajul de eroare nu dezvaluie valoarea secretului', () => {
      expect(() =>
        loadConfig({ ...valid, PAYMENT_WEBHOOK_SECRET: 'scurt-secret' }),
      ).not.toThrowError(/scurt-secret/);
    });
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

describe('loadConfig: reguli de pret si validare comenzi', () => {
  it('aplica valori implicite (TVA 19%, doua praguri de reducere, RO si MD, limite anti-frauda)', () => {
    const config = loadConfig(valid);
    expect(config.VAT_PERCENT).toBe(19);
    expect(config.DISCOUNT_TIERS).toEqual([
      { minSubtotalCents: 50_000, percent: 5 },
      { minSubtotalCents: 100_000, percent: 10 },
    ]);
    expect(config.SHIPPING_COUNTRIES).toEqual(['RO', 'MD']);
    expect(config.MAX_ORDER_AMOUNT_CENTS).toBe(100_000_000);
    expect(config.FRAUD_MAX_ORDERS_PER_WINDOW).toBe(5);
    expect(config.FRAUD_WINDOW_SECONDS).toBe(600);
    expect(config.FRAUD_SUSPICIOUS_AMOUNT_CENTS).toBe(50_000_000);
  });

  it('citeste TVA, pragurile de reducere si tarile din mediu', () => {
    const config = loadConfig({
      ...valid,
      VAT_PERCENT: '9.5',
      DISCOUNT_TIERS: ' 1000:2.5 , 20000:15 ',
      SHIPPING_COUNTRIES: 'ro, de',
    });
    expect(config.VAT_PERCENT).toBe(9.5);
    expect(config.DISCOUNT_TIERS).toEqual([
      { minSubtotalCents: 1_000, percent: 2.5 },
      { minSubtotalCents: 20_000, percent: 15 },
    ]);
    expect(config.SHIPPING_COUNTRIES).toEqual(['RO', 'DE']);
  });

  it('un sir gol dezactiveaza reducerile', () => {
    expect(loadConfig({ ...valid, DISCOUNT_TIERS: '' }).DISCOUNT_TIERS).toEqual([]);
  });

  it.each([
    ['VAT_PERCENT', '-1'],
    ['VAT_PERCENT', '101'],
    ['VAT_PERCENT', 'mult'],
    ['VAT_PERCENT', ''],
    ['VAT_PERCENT', '   '],
    ['DISCOUNT_TIERS', '50000:5,50000:10'],
    ['DISCOUNT_TIERS', '100000:5,50000:10'],
    ['DISCOUNT_TIERS', '50000:5,100000:5'],
    ['DISCOUNT_TIERS', '5000'],
    ['DISCOUNT_TIERS', '5000:0'],
    ['DISCOUNT_TIERS', '5000:101'],
    ['DISCOUNT_TIERS', 'a:5'],
    ['DISCOUNT_TIERS', '-5:5'],
    ['SHIPPING_COUNTRIES', 'ROU'],
    ['SHIPPING_COUNTRIES', 'R1'],
    ['MAX_ORDER_AMOUNT_CENTS', '0'],
    ['MAX_ORDER_AMOUNT_CENTS', '2147483648'],
    ['FRAUD_MAX_ORDERS_PER_WINDOW', '0'],
    ['FRAUD_WINDOW_SECONDS', '0'],
    ['FRAUD_SUSPICIOUS_AMOUNT_CENTS', '2147483648'],
  ])('refuza %s invalid (%s)', (name, value) => {
    expect(() => loadConfig({ ...valid, [name]: value })).toThrowError(new RegExp(name));
  });
});
