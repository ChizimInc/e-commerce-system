import type { DomainEvent, EventBus, Logger, Money } from '../../../shared';
import type { OrderStatusUpdate, OrderStatusUpdateKind } from '../domain/Notification';
import type { NotificationService } from './NotificationService';

/**
 * Forma evenimentelor comenzii asa cum le citeste acest modul: un contract minim, declarat aici (`notifications` nu
 * importa tipurile modulului `ordering`; leaga doar numele evenimentelor si campurile de mai jos).
 */
export interface OrderLifecycleEvent extends DomainEvent {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: Money;
  readonly items: readonly { readonly quantity: number }[];
  /** Doar la `OrderCancelled`. */
  readonly wasPaid?: boolean;
}

/** Evenimentul comenzii -> stadiul despre care se anunta clientul. */
const STATUS_OF_EVENT: Readonly<Record<string, OrderStatusUpdateKind>> = {
  OrderPlaced: 'PLACED',
  OrderPaid: 'PAID',
  OrderShipped: 'SHIPPED',
  OrderDelivered: 'DELIVERED',
  OrderCancelled: 'CANCELLED',
  OrderRefunded: 'REFUNDED',
};

// Pattern: Observer (Behavioral) – abonat (observer) la evenimentele comenzii: transforma fiecare schimbare de stare intr-o notificare pe canalele alese de client
export class OrderStatusNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  register(bus: EventBus): void {
    for (const type of Object.keys(STATUS_OF_EVENT)) {
      bus.subscribe<OrderLifecycleEvent>(type, (event) => this.handle(event));
    }
  }

  /** Nu arunca: o eroare de notificare nu trebuie sa afecteze comanda (nici ceilalti abonati). */
  async handle(event: OrderLifecycleEvent): Promise<void> {
    const status = STATUS_OF_EVENT[event.type];
    if (status === undefined) return;
    try {
      await this.notifications.notifyOrderStatus({
        orderId: event.orderId,
        customerId: event.customerId,
        status,
        total: event.total,
        itemCount: event.items.reduce((count, item) => count + item.quantity, 0),
        wasPaid: event.wasPaid ?? false,
      } satisfies OrderStatusUpdate);
    } catch (error) {
      this.logger.error('Notificarea unui eveniment al comenzii a esuat', {
        eventType: event.type,
        orderId: event.orderId,
        error,
      });
    }
  }
}
