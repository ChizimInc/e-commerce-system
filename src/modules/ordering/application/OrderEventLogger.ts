import type { EventBus, Logger } from '../../../shared';
import { ORDER_EVENT_TYPES, type OrderEvent } from '../domain/events/OrderEvents';

// Pattern: Observer (Behavioral) – abonat (observer) la toate evenimentele comenzii: scrie un jurnal, fara date personale
export class OrderEventLogger {
  constructor(private readonly logger: Logger) {}

  register(bus: EventBus): void {
    for (const type of ORDER_EVENT_TYPES) {
      bus.subscribe<OrderEvent>(type, (event) => {
        this.handle(event);
      });
    }
  }

  /** Doar identificatori si cifre: nici adresa, nici numele articolelor, nici identitatea clientului. */
  private handle(event: OrderEvent): void {
    this.logger.info('Eveniment comanda', {
      eventType: event.type,
      orderId: event.orderId,
      total: event.total.toString(),
      itemCount: event.items.length,
    });
  }
}
