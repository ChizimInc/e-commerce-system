import type { Shipment } from '../../domain/Shipment';
import type { ShipmentStatus } from '../../domain/ShippingTypes';

/** Port de iesire pentru persistenta livrarilor. */
export interface ShipmentRepository {
  /**
   * Insereaza o livrare noua. `orderId` si perechea (curier, id extern) sunt unice: a doua livrare a aceleiasi comenzi
   * (de ex. doua expedieri simultane) primeste `ConflictError(SHIPMENT_EXISTS)`, nu un duplicat.
   */
  insert(shipment: Shipment): Promise<void>;
  findByOrderId(orderId: string): Promise<Shipment | null>;
  /**
   * Salveaza noua stare a livrarii DOAR daca statusul din baza este inca `expectedStatus` (concurenta optimista):
   * astfel doar un proces poate revendica o expediere esuata sau poate aplica o stare de urmarire.
   * Arunca `NotFoundError` daca livrarea nu exista si `ConflictError(SHIPMENT_CHANGED)` daca statusul s-a schimbat intre timp.
   */
  update(shipment: Shipment, expectedStatus: ShipmentStatus): Promise<void>;
}
