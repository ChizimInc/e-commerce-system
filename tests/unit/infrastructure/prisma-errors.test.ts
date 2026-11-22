import { describe, expect, it } from 'vitest';
import { isPrismaError, orConflict } from '../../../src/infrastructure/persistence/prisma-errors';
import { ConflictError } from '../../../src/shared';

const prismaError = (code: string) => Object.assign(new Error('prisma'), { code });

describe('prisma-errors', () => {
  it('isPrismaError recunoaste doar codurile cerute', () => {
    expect(isPrismaError(prismaError('P2002'), 'P2002')).toBe(true);
    expect(isPrismaError(prismaError('P2025'), 'P2002', 'P2003')).toBe(false);
    expect(isPrismaError(new Error('x'), 'P2002')).toBe(false);
    expect(isPrismaError(null, 'P2002')).toBe(false);
    expect(isPrismaError('P2002', 'P2002')).toBe(false);
  });

  it('orConflict traduce unicitatea si cheia straina in ConflictError cu codul dat', async () => {
    for (const code of ['P2002', 'P2003']) {
      await expect(
        orConflict(() => Promise.reject(prismaError(code)), 'mesaj', 'COD'),
      ).rejects.toMatchObject({ code: 'COD', message: 'mesaj' });
    }
    await expect(
      orConflict(() => Promise.reject(prismaError('P2002')), 'm'),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('orConflict nu inghite alte erori si intoarce rezultatul cand totul merge', async () => {
    await expect(orConflict(() => Promise.reject(prismaError('P1001')), 'm')).rejects.toMatchObject(
      { code: 'P1001' },
    );
    await expect(orConflict(() => Promise.resolve(42), 'm')).resolves.toBe(42);
  });
});
