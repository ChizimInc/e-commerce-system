import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/** Creeaza clientul Prisma peste driverul `pg` (Prisma 7 cere un driver adapter explicit). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
/** Tipurile generate (ex. `Prisma.ProductModel`), re-exportate ca adaptoarele sa nu importe din `generated/`. */
export type { Prisma } from '../../generated/prisma/client';
