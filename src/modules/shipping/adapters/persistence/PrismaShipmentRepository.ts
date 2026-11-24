import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { ConflictError, Money, NotFoundError } from '../../../../shared';
import { Shipment } from '../../domain/Shipment';
import type { ShipmentStatus } from '../../domain/ShippingTypes';
import type { ShipmentRepository } from '../../ports/out/ShipmentRepository';

type ShipmentRow = Prisma.ShipmentGetPayload<object>;

function toDomain(row: ShipmentRow): Shipment {
  return Shipment.restore({
    id: row.id,
    orderId: row.orderId,
    courier: row.courier,
    status: row.status,
    cost: Money.of(row.costAmount, row.currency),
    externalId: row.externalId,
    trackingNumber: row.trackingNumber,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Adaptor Prisma/PostgreSQL pentru `ShipmentRepository` (tabela `shipments`). */
export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(shipment: Shipment): Promise<void> {
    // order_id este UNIQUE: a doua livrare a aceleiasi comenzi esueaza aici, atomic, chiar la cereri simultane.
    await orConflict(
      () =>
        this.prisma.shipment.create({
          data: {
            id: shipment.id,
            orderId: shipment.orderId,
            courier: shipment.courier,
            status: shipment.status,
            costAmount: shipment.cost.amount,
            currency: shipment.cost.currency,
            externalId: shipment.externalId,
            trackingNumber: shipment.trackingNumber,
            failureReason: shipment.failureReason,
            createdAt: shipment.createdAt,
            updatedAt: shipment.updatedAt,
          },
        }),
      'Comanda are deja o livrare',
      'SHIPMENT_EXISTS',
    );
  }

  async findByOrderId(orderId: string): Promise<Shipment | null> {
    const row = await this.prisma.shipment.findUnique({ where: { orderId } });
    return row ? toDomain(row) : null;
  }

  async update(shipment: Shipment, expectedStatus: ShipmentStatus): Promise<void> {
    // Conditia pe status face tranzitia atomica: daca altcineva a schimbat deja statusul, nu se actualizeaza nimic.
    const { count } = await orConflict(
      () =>
        this.prisma.shipment.updateMany({
          where: { id: shipment.id, status: expectedStatus },
          data: {
            status: shipment.status,
            externalId: shipment.externalId,
            trackingNumber: shipment.trackingNumber,
            failureReason: shipment.failureReason,
            updatedAt: shipment.updatedAt,
          },
        }),
      'Id-ul coletului apartine altei livrari',
      'SHIPMENT_CONFLICT',
    );
    if (count > 0) return;
    const exists = (await this.prisma.shipment.count({ where: { id: shipment.id } })) > 0;
    if (!exists) throw new NotFoundError('Livrare', shipment.id);
    throw new ConflictError('Livrarea a fost modificata simultan, reincearca', 'SHIPMENT_CHANGED');
  }
}
