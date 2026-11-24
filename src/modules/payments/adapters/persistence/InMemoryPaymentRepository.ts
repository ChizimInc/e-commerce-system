import { ConflictError, NotFoundError } from '../../../../shared';
import type { Payment } from '../../domain/Payment';
import type { PaymentProvider, PaymentStatus } from '../../domain/PaymentTypes';
import type { PaymentRepository } from '../../ports/out/PaymentRepository';

/**
 * Adaptor in-memory pentru `PaymentRepository`, cu aceleasi reguli de unicitate ca PostgreSQL
 * (`orderId`, cheia de idempotenta, perechea furnizor + id extern). Platile sunt imutabile, deci se pastreaza direct.
 * Verificarea si scrierea nu au `await` intre ele, deci doua cereri concurente nu pot trece amandoua.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly store = new Map<string, Payment>();

  insert(payment: Payment): Promise<void> {
    const duplicate = [...this.store.values()].some(
      (existing) =>
        existing.id === payment.id ||
        existing.orderId === payment.orderId ||
        existing.idempotencyKey === payment.idempotencyKey,
    );
    if (duplicate || this.externalIdTaken(payment)) {
      return Promise.reject(new ConflictError('Comanda are deja o plata', 'PAYMENT_EXISTS'));
    }
    this.store.set(payment.id, payment);
    return Promise.resolve();
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    const found = [...this.store.values()].find((payment) => payment.orderId === orderId);
    return Promise.resolve(found ?? null);
  }

  findByExternalId(provider: PaymentProvider, externalId: string): Promise<Payment | null> {
    const found = [...this.store.values()].find(
      (payment) => payment.provider === provider && payment.externalId === externalId,
    );
    return Promise.resolve(found ?? null);
  }

  update(payment: Payment, expectedStatus: PaymentStatus): Promise<void> {
    const current = this.store.get(payment.id);
    if (!current) return Promise.reject(new NotFoundError('Plata', payment.id));
    if (current.status !== expectedStatus) {
      return Promise.reject(
        new ConflictError('Plata a fost modificata simultan, reincearca', 'PAYMENT_CHANGED'),
      );
    }
    if (this.externalIdTaken(payment)) {
      return Promise.reject(
        new ConflictError('Id-ul tranzactiei apartine altei plati', 'PAYMENT_CONFLICT'),
      );
    }
    this.store.set(payment.id, payment);
    return Promise.resolve();
  }

  /** Perechea (furnizor, id extern) e unica intre plati (ca indexul unic din PostgreSQL). */
  private externalIdTaken(payment: Payment): boolean {
    if (payment.externalId === null) return false;
    return [...this.store.values()].some(
      (other) =>
        other.id !== payment.id &&
        other.provider === payment.provider &&
        other.externalId === payment.externalId,
    );
  }
}
