import { ConflictError, NotFoundError } from '../../../../shared';
import type { Shipment } from '../../domain/Shipment';
import type { ShipmentStatus } from '../../domain/ShippingTypes';
import type { ShipmentRepository } from '../../ports/out/ShipmentRepository';

/**
 * Adaptor in-memory pentru `ShipmentRepository`, cu aceleasi reguli de unicitate ca PostgreSQL (`orderId` si perechea
 * curier + id extern). Livrarile sunt imutabile, deci se pastreaza direct. Verificarea si scrierea nu au `await`
 * intre ele, deci doua cereri concurente nu pot trece amandoua.
 */
export class InMemoryShipmentRepository implements ShipmentRepository {
  private readonly store = new Map<string, Shipment>();

  insert(shipment: Shipment): Promise<void> {
    const duplicate = [...this.store.values()].some(
      (existing) => existing.id === shipment.id || existing.orderId === shipment.orderId,
    );
    if (duplicate || this.externalIdTaken(shipment)) {
      return Promise.reject(new ConflictError('Comanda are deja o livrare', 'SHIPMENT_EXISTS'));
    }
    this.store.set(shipment.id, shipment);
    return Promise.resolve();
  }

  findByOrderId(orderId: string): Promise<Shipment | null> {
    const found = [...this.store.values()].find((shipment) => shipment.orderId === orderId);
    return Promise.resolve(found ?? null);
  }

  update(shipment: Shipment, expectedStatus: ShipmentStatus): Promise<void> {
    const current = this.store.get(shipment.id);
    if (!current) return Promise.reject(new NotFoundError('Livrare', shipment.id));
    if (current.status !== expectedStatus) {
      return Promise.reject(
        new ConflictError('Livrarea a fost modificata simultan, reincearca', 'SHIPMENT_CHANGED'),
      );
    }
    if (this.externalIdTaken(shipment)) {
      return Promise.reject(
        new ConflictError('Id-ul coletului apartine altei livrari', 'SHIPMENT_CONFLICT'),
      );
    }
    this.store.set(shipment.id, shipment);
    return Promise.resolve();
  }

  /** Perechea (curier, id extern) e unica intre livrari (ca indexul unic din PostgreSQL). */
  private externalIdTaken(shipment: Shipment): boolean {
    if (shipment.externalId === null) return false;
    return [...this.store.values()].some(
      (other) =>
        other.id !== shipment.id &&
        other.courier === shipment.courier &&
        other.externalId === shipment.externalId,
    );
  }
}
