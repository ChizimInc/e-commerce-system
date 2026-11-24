import type { Logger } from '../../../shared';
import { OrderStatusNotification, type OrderStatusUpdate } from '../domain/Notification';
import type { ChannelType } from '../domain/NotificationTypes';
import type { NotificationChannels } from './NotificationChannels';
import type { NotificationPreferencesService } from './NotificationPreferencesService';

/**
 * Anunta clientul pe canalele alese de el: pentru fiecare canal, fabrica il creeaza (Factory Method), iar notificarea
 * (abstractia din Bridge) se trimite prin el. Nu arunca niciodata: o eroare la un canal se logheaza si nu opreste celelalte
 * canale, iar o eroare de notificare nu trebuie sa afecteze comanda.
 */
export class NotificationService {
  constructor(
    private readonly channels: NotificationChannels,
    private readonly preferences: NotificationPreferencesService,
    private readonly logger: Logger,
  ) {}

  async notifyOrderStatus(update: OrderStatusUpdate): Promise<void> {
    let types: readonly ChannelType[];
    try {
      types = await this.preferences.channelsFor(update.customerId);
    } catch (error) {
      this.logger.error('Preferintele de notificare nu au putut fi citite', {
        orderId: update.orderId,
        status: update.status,
        error,
      });
      return;
    }

    // In paralel: un canal lent (sau cazut) nu intarzie si nu opreste celelalte canale.
    await Promise.all(types.map((type) => this.sendOn(type, update)));
  }

  private async sendOn(type: ChannelType, update: OrderStatusUpdate): Promise<void> {
    try {
      const channel = this.channels.createChannel(type);
      await new OrderStatusNotification(channel, update).send(update.customerId);
    } catch (error) {
      this.logger.error('Notificarea nu a putut fi trimisa', {
        channel: type,
        orderId: update.orderId,
        status: update.status,
        error,
      });
    }
  }
}
