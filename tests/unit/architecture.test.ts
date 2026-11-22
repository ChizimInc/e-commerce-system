import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regulile arhitecturii hexagonale (docs/PLAN.md §4.1 si §10), verificate automat:
 *  - domain/, application/ si ports/ nu depind de framework-uri, drivere sau de adaptoare;
 *  - un modul nu importa interioarele altui modul (comunica prin porturi si adaptoare);
 *  - shared/ ramane fara dependente externe.
 */

const SRC = resolve(__dirname, '../../src');
const INNER_LAYERS = ['domain', 'application', 'ports'];
const FORBIDDEN_PACKAGES = [
  'express',
  '@prisma',
  'pg',
  'bcryptjs',
  'bcrypt',
  'jsonwebtoken',
  'swagger-ui-express',
  'zod',
  'dotenv',
];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers.filter((specifier): specifier is string => specifier !== undefined);
}

const files = listFiles(SRC).filter((file) => !file.includes(`${sep}generated${sep}`));
const rel = (file: string) => relative(SRC, file).split(sep).join('/');

/** Fisierele din straturile interioare ale unui modul: modules/<modul>/{domain,application,ports}/... */
const innerFiles = files.filter((file) => {
  const [root, , layer] = rel(file).split('/');
  return root === 'modules' && layer !== undefined && INNER_LAYERS.includes(layer);
});
const sharedFiles = files.filter((file) => rel(file).startsWith('shared/'));

function packageOf(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? '');
}

describe('arhitectura hexagonala', () => {
  it('gaseste fisiere de verificat (testul nu trece "in gol")', () => {
    expect(innerFiles.length).toBeGreaterThan(25);
    expect(sharedFiles.length).toBeGreaterThan(3);
  });

  it.each(innerFiles.map((file) => [rel(file), file] as const))(
    '%s nu importa framework-uri, drivere sau adaptoare',
    (_name, file) => {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.')) {
          const target = rel(resolve(dirname(file), specifier));
          expect(target, `import interzis: ${specifier}`).not.toMatch(
            /(^|\/)(adapters|infrastructure|generated)(\/|$)/,
          );
        } else if (!specifier.startsWith('node:')) {
          expect(FORBIDDEN_PACKAGES, `import interzis: ${specifier}`).not.toContain(
            packageOf(specifier),
          );
        }
      }
    },
  );

  it.each(innerFiles.map((file) => [rel(file), file] as const))(
    '%s nu depinde de interioarele altui modul',
    (name, file) => {
      const ownModule = name.split('/')[1];
      for (const specifier of importsOf(file).filter((s) => s.startsWith('.'))) {
        const target = rel(resolve(dirname(file), specifier)).split('/');
        if (target[0] === 'modules') {
          expect(target[1], `${specifier} iese din modulul ${ownModule}`).toBe(ownModule);
        }
      }
    },
  );

  it.each(sharedFiles.map((file) => [rel(file), file] as const))(
    '%s (shared) nu are dependente externe in afara de node:',
    (_name, file) => {
      for (const specifier of importsOf(file)) {
        expect(
          specifier.startsWith('.') || specifier.startsWith('node:'),
          `import: ${specifier}`,
        ).toBe(true);
        if (specifier.startsWith('.')) {
          expect(rel(resolve(dirname(file), specifier)).startsWith('shared'), specifier).toBe(true);
        }
      }
    },
  );
});
