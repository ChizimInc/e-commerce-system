import { z } from 'zod';
import type { DiscountTier } from './modules/ordering/domain/pricing/PriceCalculator';

/** Prefixul secretului din .env.example: o instanta de productie nu trebuie sa ruleze cu el. */
const PLACEHOLDER_SECRET_PREFIX = 'replace-me';

/** Pragurile ordonate dupa suma au praguri distincte si procente strict crescatoare. */
function isCoherent(tiers: readonly DiscountTier[]): boolean {
  const sorted = [...tiers].sort((a, b) => a.minSubtotalCents - b.minSubtotalCents);
  return sorted.every(
    (tier, i) =>
      i === 0 ||
      (tier.minSubtotalCents > (sorted[i - 1]?.minSubtotalCents ?? -1) &&
        tier.percent > (sorted[i - 1]?.percent ?? 0)),
  );
}

/** `"50000:5,100000:10"` -> de la 500.00 reducere 5%, de la 1000.00 reducere 10%. Sirul gol = fara reduceri; `null` = format invalid sau praguri incoerente
 * (pragurile trebuie sa fie distincte, iar procentul sa creasca strict odata cu pragul). */
function parseDiscountTiers(value: string): DiscountTier[] | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const tiers: DiscountTier[] = [];
  for (const part of parts) {
    const match = /^(\d{1,10}):(\d{1,3}(?:\.\d{1,2})?)$/.exec(part);
    if (!match) return null;
    const minSubtotalCents = Number(match[1]);
    const percent = Number(match[2]);
    if (!Number.isSafeInteger(minSubtotalCents) || percent <= 0 || percent > 100) return null;
    tiers.push({ minSubtotalCents, percent });
  }
  return isCoherent(tiers) ? tiers : null;
}

/** `"RO,MD"` -> coduri ISO de 2 litere, cu majuscule; `null` = format invalid. */
function parseCountries(value: string): string[] | null {
  const countries = value
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  return countries.every((country) => /^[A-Z]{2}$/.test(country)) ? countries : null;
}

/** Cel mai mare cuantum (in cenți) care incape intr-un INTEGER PostgreSQL. */
const MAX_INTEGER_CENTS = 2_147_483_647;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DATABASE_URL: z
      .string()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), 'trebuie sa fie un URL PostgreSQL'),
    JWT_SECRET: z.string().min(32, 'trebuie sa aiba cel putin 32 de caractere'),
    /** Valabilitatea tokenului de acces, in secunde (implicit 1 ora, maxim 24 de ore: tokenurile nu se pot revoca). */
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    /** Limita de cereri per IP pe /auth/register si /auth/login, intr-o fereastra de timp. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(30),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
    /** Costul bcrypt (2^n iteratii). Peste 15 devine impracticabil de lent. */
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
    /** Cota TVA (procente) adaugata la subtotalul redus al comenzii; 0 = fara TVA. */
    // `coerce` transforma un sir gol in 0: o valoare lipsita din .env ar dezactiva TVA fara sa avertizeze, deci o refuzam.
    VAT_PERCENT: z
      .string()
      .trim()
      .min(1, 'nu poate fi gol (pentru fara TVA, pune 0)')
      .transform(Number)
      .pipe(z.number().min(0).max(100))
      .default(19),
    /** Praguri de reducere dupa subtotal, `cenți:procent` separate prin virgula (gol = fara reduceri). */
    DISCOUNT_TIERS: z
      .string()
      .default('50000:5,100000:10')
      .refine((value) => parseDiscountTiers(value) !== null, 'format asteptat: "cenți:procent,..."')
      .transform((value) => parseDiscountTiers(value) ?? []),
    /** Tarile in care se livreaza (coduri ISO de 2 litere, separate prin virgula). */
    SHIPPING_COUNTRIES: z
      .string()
      .default('RO,MD')
      .refine(
        (value) => parseCountries(value) !== null,
        'coduri ISO de 2 litere, separate prin virgula',
      )
      .transform((value) => parseCountries(value) ?? []),
    /** Totalul maxim al unei comenzi, in cenți. */
    MAX_ORDER_AMOUNT_CENTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_INTEGER_CENTS)
      .default(100_000_000),
    /** Anti-frauda: cate comenzi are voie sa plaseze un client intr-o fereastra de timp. */
    FRAUD_MAX_ORDERS_PER_WINDOW: z.coerce.number().int().min(1).max(1000).default(5),
    FRAUD_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
    /** Secretul cu care furnizorii (mock) isi semneaza webhook-urile (HMAC). Minim 16 caractere. */
    PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'trebuie sa aiba cel putin 16 caractere'),
    /** Anti-frauda: un total peste aceasta suma (in cenți) cere verificare manuala. */
    FRAUD_SUSPICIOUS_AMOUNT_CENTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_INTEGER_CENTS)
      .default(50_000_000),
  })
  .refine(
    (env) =>
      !(env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith(PLACEHOLDER_SECRET_PREFIX)),
    {
      path: ['JWT_SECRET'],
      message: 'valoarea de exemplu din .env.example nu e permisa in productie',
    },
  )
  .refine(
    (env) =>
      !(
        env.NODE_ENV === 'production' &&
        env.PAYMENT_WEBHOOK_SECRET.startsWith(PLACEHOLDER_SECRET_PREFIX)
      ),
    {
      path: ['PAYMENT_WEBHOOK_SECRET'],
      message: 'valoarea de exemplu din .env.example nu e permisa in productie',
    },
  );

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Citeste si valideaza variabilele de mediu. Mesajul de eroare nu include valorile (pot fi secrete). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configurare invalida:\n${details}`);
  }
  return result.data;
}
