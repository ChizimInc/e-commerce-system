import type { IdGenerator } from '../../src/shared';

/** UUID v4 valid si determinist, pentru teste: `uuid(1)` -> `00000000-0000-4000-8000-000000000001`. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Genereaza id-uri previzibile, pornind de la un offset (ca sa nu se ciocneasca cu fixture-urile). */
export class SequentialIdGenerator implements IdGenerator {
  private counter: number;

  constructor(start = 1000) {
    this.counter = start;
  }

  next(): string {
    return uuid(this.counter++);
  }
}
