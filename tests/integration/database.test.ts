import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/infrastructure/persistence/prisma-client';

// Ruleaza doar daca DATABASE_URL e setat (din .env) si PostgreSQL e pornit (`docker compose up -d`).
// Fara DATABASE_URL (ex. CI fara baza de date) testul este sarit, nu esuat.
describe.skipIf(!process.env['DATABASE_URL'])('PostgreSQL + Prisma', () => {
  const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('raspunde la SELECT 1', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it('are migratia aplicata (tabela users exista si e interogabila)', async () => {
    const count = await prisma.user.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
