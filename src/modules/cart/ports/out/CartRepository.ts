import type { Cart } from '../../domain/Cart';

/** Port de iesire pentru persistenta cosurilor (un cos per utilizator). */
export interface CartRepository {
  findByUserId(userId: string): Promise<Cart | null>;
  /** Insereaza sau inlocuieste cosul (inclusiv articolele lui). */
  save(cart: Cart): Promise<void>;
}
