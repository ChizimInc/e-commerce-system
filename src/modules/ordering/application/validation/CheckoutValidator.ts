import type { Order } from '../../domain/Order';
import type { OrderableItem } from '../../ports/out/OrderCatalog';

/** O linie a comenzii, impreuna cu datele ei curente din catalog (stoc disponibil). */
export interface CheckoutLine {
  readonly item: OrderableItem;
  readonly quantity: number;
}

/** Ce vad verigile lantului: comanda deja construita (cu pretul calculat) si liniile ei din catalog. */
export interface CheckoutContext {
  readonly order: Order;
  readonly lines: readonly CheckoutLine[];
}

/** Interfata comuna a verigilor: `validate` arunca o eroare de domeniu ca sa opreasca plasarea comenzii. */
export interface CheckoutValidator {
  validate(context: CheckoutContext): Promise<void>;
}

// Pattern: Chain of Responsibility (Behavioral) – veriga de baza: ruleaza propria regula, apoi pasa contextul urmatoarei verigi; o eroare opreste lantul
export abstract class AbstractCheckoutValidator implements CheckoutValidator {
  private next: CheckoutValidator | undefined;

  /** Leaga veriga urmatoare si o intoarce, ca legarea sa se poata inlantui: `a.setNext(b).setNext(c)`. */
  setNext<V extends CheckoutValidator>(next: V): V {
    this.next = next;
    return next;
  }

  async validate(context: CheckoutContext): Promise<void> {
    await this.check(context);
    await this.next?.validate(context);
  }

  /** Regula acestei verigi; arunca daca comanda nu trece. */
  protected abstract check(context: CheckoutContext): void | Promise<void>;
}

/**
 * Leaga verigile in ordinea data si intoarce prima veriga. Se apeleaza in composition root:
 * o veriga noua se adauga acolo, fara sa se modifice `OrderService`.
 */
export function chainOf(
  first: AbstractCheckoutValidator,
  ...rest: AbstractCheckoutValidator[]
): CheckoutValidator {
  let last = first;
  for (const validator of rest) last = last.setNext(validator);
  return first;
}
