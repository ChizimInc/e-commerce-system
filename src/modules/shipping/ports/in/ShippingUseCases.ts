import type { Money, Principal } from '../../../../shared';
import type { Shipment } from '../../domain/Shipment';
import type { ShippingCostRequest } from '../../domain/ShippingCostStrategy';
import type { CourierCode, DeliveryMethod } from '../../domain/ShippingTypes';

/** Port de intrare: expedierea unei comenzi platite (doar ADMIN). */
export interface ShipOrderUseCase {
  /**
   * Preda comanda PAID curierului metodei ei de livrare, o trece in SHIPPED si emite `OrderShipped`.
   * Doar ADMIN (`ForbiddenError`). O comanda nu se expediaza de doua ori (`ConflictError`), nici la cereri simultane.
   * O expediere refuzata sau esuata la curier poate fi reluata.
   */
  execute(principal: Principal, orderId: string): Promise<Shipment>;
}

/** Port de intrare: starea livrarii unei comenzi. */
export interface GetOrderShipmentUseCase {
  /**
   * Proprietarul comenzii sau ADMIN; `NotFoundError` daca comanda nu e a ta sau nu are livrare.
   * Cat timp coletul e la curier, starea se reimprospateaza din urmarirea curierului.
   */
  execute(principal: Principal, orderId: string): Promise<Shipment>;
}

/** Costul livrarii pentru o metoda, in cosul clientului. */
export interface ShippingOption {
  readonly deliveryMethod: DeliveryMethod;
  /** Cine ar duce coletul. */
  readonly courier: CourierCode;
  readonly cost: Money;
}

export interface CartShippingQuote {
  readonly itemsValue: Money;
  readonly units: number;
  readonly options: readonly ShippingOption[];
}

/** Port de intrare: cotatia livrarii pentru cosul clientului, inainte de checkout. */
export interface QuoteShippingUseCase {
  /** Costul fiecarei metode de livrare pentru cosul curent (`DomainError(CART_EMPTY)` daca e gol). */
  quoteCart(principal: Principal): Promise<CartShippingQuote>;
}

/**
 * Port de intrare pentru alte module (nu se expune prin HTTP): costul unei metode de livrare, calculat de strategia
 * ei. Pur si sincron; il foloseste `ordering` ca sa includa livrarea in totalul comenzii.
 */
export interface ShippingCostQuotes {
  quote(method: DeliveryMethod, request: ShippingCostRequest): Money;
}
