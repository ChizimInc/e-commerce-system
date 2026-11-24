import {
  ConflictError,
  NotFoundError,
  type Clock,
  type Logger,
  type Principal,
} from '../../../shared';
import type { Shipment } from '../domain/Shipment';
import type { GetOrderShipmentUseCase } from '../ports/in/ShippingUseCases';
import type { ShippableOrders } from '../ports/out/ShippableOrders';
import type { ShipmentRepository } from '../ports/out/ShipmentRepository';
import type { CourierDirectory } from './CourierDirectory';

/**
 * Starea livrarii unei comenzi, vazuta de proprietar sau de ADMIN. Cat timp coletul e la curier, starea se
 * reimprospateaza din urmarirea lui; daca curierul nu raspunde, se intoarce ultima stare salvata (urmarirea e informativa).
 */
export class GetOrderShipment implements GetOrderShipmentUseCase {
  constructor(
    private readonly orders: ShippableOrders,
    private readonly shipments: ShipmentRepository,
    private readonly couriers: CourierDirectory,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(principal: Principal, orderId: string): Promise<Shipment> {
    const order = await this.orders.find(orderId);
    // Comanda altcuiva se raporteaza ca inexistenta (nu 403), ca sa nu confirmam ca exista.
    if (!order || (principal.role !== 'ADMIN' && order.customerId !== principal.userId)) {
      throw new NotFoundError('Comanda', orderId);
    }
    const shipment = await this.shipments.findByOrderId(orderId);
    if (!shipment) throw new NotFoundError('Livrare', orderId);
    return shipment.isTrackable() ? this.refresh(shipment) : shipment;
  }

  private async refresh(shipment: Shipment): Promise<Shipment> {
    const { externalId } = shipment;
    if (externalId === null) return shipment;
    try {
      const { status } = await this.couriers.serviceOf(shipment.courier).track(externalId);
      const updated = shipment.tracked(status, this.clock());
      if (updated === shipment) return shipment;
      await this.shipments.update(updated, shipment.status);
      return updated;
    } catch (error) {
      if (error instanceof ConflictError) {
        // Alta cerere a reimprospatat-o intre timp: ii citim rezultatul.
        return (await this.shipments.findByOrderId(shipment.orderId)) ?? shipment;
      }
      this.logger.warn('Urmarirea la curier a esuat, se intoarce ultima stare salvata', {
        shipmentId: shipment.id,
        courier: shipment.courier,
        error,
      });
      return shipment;
    }
  }
}
