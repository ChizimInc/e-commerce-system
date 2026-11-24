import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import type { NotificationRecord } from '../../domain/NotificationRecord';
import type {
  NotificationListFilter,
  NotificationOutbox,
} from '../../ports/out/NotificationOutbox';

type LogRow = Prisma.NotificationLogGetPayload<object>;

function toDomain(row: LogRow): NotificationRecord {
  return {
    id: row.id,
    recipientId: row.recipientId,
    channel: row.channel,
    kind: row.kind,
    orderId: row.orderId,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt,
  };
}

/** Adaptor Prisma/PostgreSQL pentru `NotificationOutbox` (tabela `notifications_log`). */
export class PrismaNotificationOutbox implements NotificationOutbox {
  constructor(private readonly prisma: PrismaClient) {}

  async append(record: NotificationRecord): Promise<void> {
    await orConflict(
      () =>
        this.prisma.notificationLog.create({
          data: {
            id: record.id,
            recipientId: record.recipientId,
            channel: record.channel,
            kind: record.kind,
            orderId: record.orderId,
            subject: record.subject,
            body: record.body,
            createdAt: record.createdAt,
          },
        }),
      'Notificarea exista deja sau destinatarul nu mai exista',
      'NOTIFICATION_CONFLICT',
    );
  }

  async listByRecipient({
    recipientId,
    limit,
    offset,
  }: NotificationListFilter): Promise<{ items: NotificationRecord[]; total: number }> {
    const where = { recipientId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationLog.findMany({
        where,
        // `seq` = ordinea inserarii: departajeaza notificarile create in aceeasi milisecunda.
        orderBy: { seq: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }
}
