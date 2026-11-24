import type { PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { normalizeChannels, type ChannelType } from '../../domain/NotificationTypes';
import type { NotificationPreferenceRepository } from '../../ports/out/NotificationPreferenceRepository';

/** Adaptor Prisma/PostgreSQL pentru `NotificationPreferenceRepository` (tabela `notification_preferences`). */
export class PrismaNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(userId: string): Promise<readonly ChannelType[] | null> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    // PostgreSQL nu garanteaza ordinea unui array: o normalizam, ca la in-memory.
    return row ? normalizeChannels(row.channels) : null;
  }

  async save(userId: string, channels: readonly ChannelType[]): Promise<void> {
    // Upsert: doua cereri simultane ale aceluiasi utilizator se suprapun fara eroare (ultima scriere castiga).
    await orConflict(
      () =>
        this.prisma.notificationPreference.upsert({
          where: { userId },
          create: { userId, channels: [...channels] },
          update: { channels: [...channels] },
        }),
      'Utilizatorul nu mai exista',
      'USER_NOT_FOUND',
    );
  }
}
