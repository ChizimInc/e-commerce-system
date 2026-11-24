import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { ConflictError, Money, NotFoundError } from '../../../../shared';
import { Address } from '../../domain/Address';
import { Order } from '../../domain/Order';
import { OrderItem } from '../../domain/OrderItem';
import type { OrderStatus } from '../../domain/OrderTypes';
import { PriceBreakdown } from '../../domain/pricing/PriceBreakdown';
import type { OrderListFilter, OrderRepository } from '../../ports/out/OrderRepository';

type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** Linia `orders` + liniile ei, gata de inserat (folosita si de plasarea atomica a comenzii). */
export function toOrderCreateInput(order: Order): Prisma.OrderUncheckedCreateInput {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    subtotalAmount: order.price.subtotal.amount,
    discountAmount: order.price.discount.amount,
    vatAmount: order.price.vat.amount,
    totalAmount: order.price.total.amount,
    currency: order.total.currency,
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    shippingRecipient: order.address.recipientName,
    shippingStreet: order.address.street,
    shippingCity: order.address.city,
    shippingPostalCode: order.address.postalCode,
    shippingCountry: order.address.country,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    items: {
      create: order.items.map((item, position) => ({
        itemId: item.itemId,
        name: item.name,
        unitPriceAmount: item.unitPrice.amount,
        quantity: item.quantity,
        position,
      })),
    },
  };
}

function toDomain(row: OrderRow): Order {
  return Order.restore({
    id: row.id,
    customerId: row.customerId,
    items: [...row.items]
      .sort((a, b) => a.position - b.position)
      .map((item) =>
        OrderItem.create({
          itemId: item.itemId,
          name: item.name,
          unitPrice: Money.of(item.unitPriceAmount, row.currency),
          quantity: item.quantity,
        }),
      ),
    address: Address.of({
      recipientName: row.shippingRecipient,
      street: row.shippingStreet,
      city: row.shippingCity,
      postalCode: row.shippingPostalCode,
      country: row.shippingCountry,
    }),
    deliveryMethod: row.deliveryMethod,
    paymentMethod: row.paymentMethod,
    price: PriceBreakdown.restore({
      subtotal: Money.of(row.subtotalAmount, row.currency),
      discount: Money.of(row.discountAmount, row.currency),
      vat: Money.of(row.vatAmount, row.currency),
      total: Money.of(row.totalAmount, row.currency),
    }),
    createdAt: row.createdAt,
    status: row.status,
    paidAt: row.paidAt,
  });
}

/** Adaptor Prisma/PostgreSQL pentru `OrderRepository` (tabelele `orders` + `order_items`). */
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(order: Order): Promise<void> {
    await orConflict(
      () => this.prisma.order.create({ data: toOrderCreateInput(order) }),
      'Comanda exista deja sau clientul nu mai exista',
      'ORDER_CONFLICT',
    );
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    return row ? toDomain(row) : null;
  }

  async findByCustomerId({
    customerId,
    limit,
    offset,
  }: OrderListFilter): Promise<{ items: Order[]; total: number }> {
    const where = { customerId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  countByCustomerSince(customerId: string, since: Date): Promise<number> {
    return this.prisma.order.count({ where: { customerId, createdAt: { gte: since } } });
  }

  async updateStatus(order: Order, expectedStatus: OrderStatus): Promise<void> {
    // Conditia pe status face tranzitia atomica: daca altcineva a schimbat deja statusul, nu se actualizeaza nimic.
    const { count } = await this.prisma.order.updateMany({
      where: { id: order.id, status: expectedStatus },
      data: { status: order.status, paidAt: order.paidAt },
    });
    if (count > 0) return;
    const exists = (await this.prisma.order.count({ where: { id: order.id } })) > 0;
    if (!exists) throw new NotFoundError('Comanda', order.id);
    throw new ConflictError('Comanda a fost modificata simultan, reincearca', 'ORDER_CHANGED');
  }
}
