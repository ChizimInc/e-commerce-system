import type { EventBus, Logger } from '../../../shared';
import type { OrderCancelled } from '../domain/events/OrderEvents';
import type { OrderCatalog } from '../ports/out/OrderCatalog';
import type { StockRestoration } from '../ports/out/StockRestoration';
import { aggregateStock } from './stockRequirements';

// Pattern: Observer (Behavioral) – abonat (observer) la OrderCancelled: repune in stoc ce a consumat comanda anulata, inclusiv componentele pachetelor
export class RestockOnOrderCancelled {
  constructor(
    private readonly catalog: OrderCatalog,
    private readonly restoration: StockRestoration,
    private readonly logger: Logger,
  ) {}

  register(bus: EventBus): void {
    bus.subscribe<OrderCancelled>('OrderCancelled', (event) => this.handle(event));
  }

  /**
   * Stocul se calculeaza cu cerintele CURENTE de stoc ale articolelor din catalog (`stockRequirements()`,
   * pe care le-a folosit si plasarea). Un articol sters intre timp nu mai are ce repune si e sarit.
   */
  async handle(event: OrderCancelled): Promise<void> {
    const lines = [];
    for (const { itemId, quantity } of event.items) {
      const item = await this.catalog.find(itemId);
      if (!item) {
        this.logger.warn('Articol disparut din catalog: stocul lui nu se mai repune', {
          orderId: event.orderId,
          itemId,
        });
        continue;
      }
      lines.push({ item, quantity });
    }

    const stock = aggregateStock(lines);
    if (stock.length === 0) {
      // Nimic de repus (toate articolele au disparut din catalog): nu marcam comanda ca procesata.
      this.logger.warn('Anulare fara stoc de repus', { orderId: event.orderId });
      return;
    }
    const restored = await this.restoration.restore(event.orderId, stock);
    this.logger.info(
      restored
        ? 'Stoc repus dupa anulare'
        : 'Anulare deja procesata: stocul nu se repune a doua oara',
      { orderId: event.orderId },
    );
  }
}
