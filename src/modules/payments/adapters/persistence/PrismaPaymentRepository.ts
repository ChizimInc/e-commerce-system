import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { ConflictError, Money, NotFoundError } from '../../../../shared';
import { Payment } from '../../domain/Payment';
import type { PaymentProvider, PaymentStatus } from '../../domain/PaymentTypes';
import type { PaymentRepository } from '../../ports/out/PaymentRepository';

type PaymentRow = Prisma.PaymentGetPayload<object>;

function toDomain(row: PaymentRow): Payment {
  return Payment.restore({
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    amount: Money.of(row.amount, row.currency),
    status: row.status,
    externalId: row.externalId,
    refundExternalId: row.refundExternalId,
    failureReason: row.failureReason,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Adaptor Prisma/PostgreSQL pentru `PaymentRepository` (tabela `payments`). */
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(payment: Payment): Promise<void> {
    // order_id si idempotency_key sunt UNIQUE: a doua plata a aceleiasi comenzi esueaza aici, atomic, chiar la cereri simultane.
    await orConflict(
      () =>
        this.prisma.payment.create({
          data: {
            id: payment.id,
            orderId: payment.orderId,
            provider: payment.provider,
            status: payment.status,
            amount: payment.amount.amount,
            currency: payment.amount.currency,
            externalId: payment.externalId,
            refundExternalId: payment.refundExternalId,
            failureReason: payment.failureReason,
            idempotencyKey: payment.idempotencyKey,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
          },
        }),
      'Comanda are deja o plata',
      'PAYMENT_EXISTS',
    );
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { orderId } });
    return row ? toDomain(row) : null;
  }

  async findByExternalId(provider: PaymentProvider, externalId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({
      where: { provider_externalId: { provider, externalId } },
    });
    return row ? toDomain(row) : null;
  }

  async update(payment: Payment, expectedStatus: PaymentStatus): Promise<void> {
    // Conditia pe status face tranzitia atomica: daca altcineva a schimbat deja statusul, nu se actualizeaza nimic.
    const { count } = await orConflict(
      () =>
        this.prisma.payment.updateMany({
          where: { id: payment.id, status: expectedStatus },
          data: {
            status: payment.status,
            externalId: payment.externalId,
            refundExternalId: payment.refundExternalId,
            failureReason: payment.failureReason,
            updatedAt: payment.updatedAt,
          },
        }),
      'Id-ul tranzactiei apartine altei plati',
      'PAYMENT_CONFLICT',
    );
    if (count > 0) return;
    const exists = (await this.prisma.payment.count({ where: { id: payment.id } })) > 0;
    if (!exists) throw new NotFoundError('Plata', payment.id);
    throw new ConflictError('Plata a fost modificata simultan, reincearca', 'PAYMENT_CHANGED');
  }
}
