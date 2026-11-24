import type { Logger } from '../Logger';
import type { DomainEvent, EventBus, EventHandler, Unsubscribe } from './EventBus';

// Pattern: Observer (Behavioral) – subiectul: publica evenimente catre abonatii inregistrati, fara sa-i cunoasca si fara sa depinda de erorile lor
/**
 * Adaptor in-memory pentru `EventBus`: livrare sincrona in acelasi proces, in ordinea abonarii.
 * Nu are persistenta sau reincercari: un eveniment pierdut (proces oprit) nu se reia.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<DomainEvent>>>();

  constructor(private readonly logger: Logger) {}

  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe {
    const set = this.handlers.get(type) ?? new Set<EventHandler<DomainEvent>>();
    // Un abonat primeste doar evenimentele tipului la care s-a abonat, deci tipul lui E e sigur aici.
    const stored = handler as EventHandler<DomainEvent>;
    set.add(stored);
    this.handlers.set(type, set);
    return () => {
      set.delete(stored);
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    // Copie: un abonat care se (de)aboneaza in timpul livrarii nu modifica runda curenta.
    for (const handler of [...(this.handlers.get(event.type) ?? [])]) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error('Abonatul unui eveniment a esuat', { eventType: event.type, error });
      }
    }
  }
}
