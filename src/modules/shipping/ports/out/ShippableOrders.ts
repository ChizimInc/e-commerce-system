import type { Money } from '../../../../shared';
import type { DeliveryMethod } from '../../domain/ShippingTypes';
import type { CourierRecipient } from './CourierService';

/**
 * Ce stie modulul `shipping` despre starea unei comenzi (nu depinde de modelul modulului `ordering`):
 *  - `AWAITING_SHIPMENT`: comanda e PAID, deci poate fi expediata;
 *  - `SHIPPED`: a fost deja expediata (si e, eventual, livrata);
 *  - `NOT_SHIPPABLE`: nu poate fi expediata (neplatita, anulata sau rambursata).
 */
export type ShippableOrderState = 'AWAITING_SHIPMENT' | 'SHIPPED' | 'NOT_SHIPPABLE';

export interface ShippableOrder {
  readonly id: string;
  readonly customerId: string;
  readonly state: ShippableOrderState;
  readonly deliveryMethod: DeliveryMethod;
  readonly recipient: CourierRecipient;
  /** Numarul de bucati comandate. */
  readonly units: number;
  /** Totalul comenzii: valoarea declarata la curier. */
  readonly total: Money;
  /** Costul livrarii cat a fost calculat la plasarea comenzii. */
  readonly shippingCost: Money;
}

/** Port de iesire: legatura cu comenzile (anti-corruption layer catre modulul `ordering`). */
export interface ShippableOrders {
  find(orderId: string): Promise<ShippableOrder | null>;
  /** PAID -> SHIPPED (emite `OrderShipped`). Arunca daca comanda nu mai e PAID (ex. anulata intre timp). */
  markShipped(orderId: string): Promise<void>;
}
