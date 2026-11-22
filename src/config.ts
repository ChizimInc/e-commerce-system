import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'trebuie sa fie un URL PostgreSQL'),
  JWT_SECRET: z.string().min(32, 'trebuie sa aiba cel putin 32 de caractere'),
});

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
