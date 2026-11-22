import type { PricedCart } from '../../domain/PricedCart';

/** Port de intrare: operatiile pe cosul unui utilizator (toate intorc cosul rezultat, cu total). */
export interface CartUseCases {
  getCart(userId: string): Promise<PricedCart>;
  /** Adauga (sau aduna la) un articol; valideaza existenta in catalog si stocul. */
  addItem(userId: string, itemId: string, quantity: number): Promise<PricedCart>;
  /** Seteaza cantitatea unui articol deja din cos; valideaza stocul. */
  updateQuantity(userId: string, itemId: string, quantity: number): Promise<PricedCart>;
  removeItem(userId: string, itemId: string): Promise<PricedCart>;
  clear(userId: string): Promise<PricedCart>;
}
