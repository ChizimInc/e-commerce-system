import type { Money } from '../../../../shared';
import type { DeliveryMethod } from '../OrderTypes';

/** Ce trebuie sa stie calculul de livrare despre o comanda: metoda aleasa, valoarea marfii si numarul de bucati. */
export interface ShippingPricingRequest {
  readonly deliveryMethod: DeliveryMethod;
  /** Valoarea marfii inainte de reducere (aceeasi cu cea pe care o vede clientul in cos la cotatie). */
  readonly itemsValue: Money;
  /** Numarul de bucati comandate (nu exista inca greutate pe produse). */
  readonly units: number;
}

/**
 * Port al domeniului `ordering` pentru costul livrarii. Il implementeaza un adaptor care apeleaza modulul
 * `shipping` (anti-corruption layer): `ordering` nu stie cum se calculeaza costul, doar ca il poate cere.
 * Calculul e pur si sincron (strategii de cost, fara I/O).
 */
export interface ShippingPricing {
  costFor(request: ShippingPricingRequest): Money;
}
