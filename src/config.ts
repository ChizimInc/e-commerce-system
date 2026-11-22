import { z } from 'zod';

/** Prefixul secretului din .env.example: o instanta de productie nu trebuie sa ruleze cu el. */
const PLACEHOLDER_SECRET_PREFIX = 'replace-me';

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
  })
  .refine(
    (env) =>
      !(env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith(PLACEHOLDER_SECRET_PREFIX)),
    {
      path: ['JWT_SECRET'],
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
