import { ConflictError } from '../../shared';

/** Coduri Prisma pentru incalcari de constrangeri (https://www.prisma.io/docs/orm/reference/error-reference). */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

/** Este eroarea una dintre cele cu codurile date? (duck-typing, ca adaptoarele sa nu importe clasele Prisma) */
export function isPrismaError(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}

/**
 * Ruleaza o scriere si traduce incalcarile de constrangeri (unicitate / cheie straina), care apar
 * cand doua cereri concurente se intrepatrund, in `ConflictError` (409) in loc de 500.
 */
export async function orConflict<T>(
  action: () => Promise<T>,
  message: string,
  code = 'CONFLICT',
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION, PRISMA_FOREIGN_KEY_VIOLATION)) {
      throw new ConflictError(message, code);
    }
    throw error;
  }
}
