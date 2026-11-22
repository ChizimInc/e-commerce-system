import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Vid permite `prisma generate` (build/CI) fara baza de date; migrarile cer DATABASE_URL real.
    url: process.env['DATABASE_URL'] ?? '',
  },
});
