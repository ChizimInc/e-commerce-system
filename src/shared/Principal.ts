export const ROLES = ['CUSTOMER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Identitatea autentificata care efectueaza o cerere (rezultatul verificarii tokenului).
 * Este in `shared` deoarece o folosesc mai multe module (catalog, cart) fara sa depinda de `identity`.
 */
export interface Principal {
  readonly userId: string;
  readonly role: Role;
}
