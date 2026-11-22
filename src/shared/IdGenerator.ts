import { randomUUID } from 'node:crypto';

/** Port pentru generarea identificatorilor: cazurile de utilizare nu depind de o sursa concreta. */
export interface IdGenerator {
  next(): string;
}

/** Implementare implicita: UUID v4 aleatoriu. */
export class RandomUuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
