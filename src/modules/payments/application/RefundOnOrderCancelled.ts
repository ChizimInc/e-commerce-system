import { ConflictError, type DomainEvent, type EventBus, type Logger } from '../../../shared';
import type { PayableOrders } from '../ports/out/PayableOrders';
import type { PaymentRepository } from '../ports/out/PaymentRepository';
import type { RefundPayment } from './RefundPayment';

/**
 * Forma evenimentului `OrderCancelled` asa cum o citeste acest modul: un contract minim, declarat aici
 * (`payments` nu importa tipurile modulului `ordering`; leaga doar numele evenimentului si campurile de mai jos).
 */
export interface OrderCancelledEvent extends DomainEvent {
  readonly type: 'OrderCancelled';
  readonly orderId: string;
  /** A fost platita inainte de anulare. */
  readonly wasPaid: boolean;
}

// Pattern: Observer (Behavioral) – abonat (observer) la OrderCancelled: daca comanda fusese platita, ii ramburseaza plata si o duce in REFUNDED
export class RefundOnOrderCancelled {
  constructor(
    private readonly orders: PayableOrders,
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundPayment,
    private readonly logger: Logger,
  ) {}

  register(bus: EventBus): void {
    bus.subscribe<OrderCancelledEvent>('OrderCancelled', (event) => this.handle(event));
  }

  /**
   * Idempotent: aceeasi anulare procesata de doua ori ramburseaza o singura data (rambursarea se revendica
   * cu CAS), iar a doua rulare doar verifica ca si comanda e REFUNDED (`markRefunded` e idempotent).
   */
  async handle(event: OrderCancelledEvent): Promise<void> {
    if (!event.wasPaid) return; // nimic incasat, nimic de rambursat

    let payment = await this.payments.findByOrderId(event.orderId);
    if (!payment) {
      // Comanda a fost marcata PAID manual de ADMIN, fara plata prin acest modul.
      this.logger.warn(
        'Comanda platita anulata fara inregistrare de plata: nu exista ce rambursa',
        {
          orderId: event.orderId,
        },
      );
      return;
    }

    if (payment.status === 'CAPTURED') {
      try {
        payment = await this.refunds.execute(payment);
      } catch (error) {
        if (error instanceof ConflictError) {
          // Alt proces a revendicat deja rambursarea: el o duce la capat.
          this.logger.info('Rambursarea acestei comenzi este deja in curs', {
            orderId: event.orderId,
          });
          return;
        }
        throw error;
      }
    }

    if (payment.status === 'REFUNDED') {
      await this.orders.markRefunded(event.orderId);
      return;
    }
    this.logger.warn('Plata nu e rambursabila in starea curenta: comanda ramane CANCELLED', {
      orderId: event.orderId,
      paymentStatus: payment.status,
    });
  }
}
