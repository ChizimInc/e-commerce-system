import type { Payment } from '../../domain/Payment';
import type { PaymentProvider, PaymentStatus } from '../../domain/PaymentTypes';

/** Port de iesire pentru persistenta platilor. */
export interface PaymentRepository {
  /**
   * Insereaza o plata noua. Cheia de idempotenta si `orderId` sunt unice: a doua plata a aceleiasi comenzi
   * (de ex. doua cereri simultane) primeste `ConflictError(PAYMENT_EXISTS)`, nu un duplicat.
   */
  insert(payment: Payment): Promise<void>;
  findByOrderId(orderId: string): Promise<Payment | null>;
  /** Cautare dupa id-ul tranzactiei la furnizor (webhook-uri). */
  findByExternalId(provider: PaymentProvider, externalId: string): Promise<Payment | null>;
  /**
   * Salveaza noua stare a platii DOAR daca statusul din baza este inca `expectedStatus` (concurenta optimista):
   * astfel doar un proces poate revendica o rambursare sau relua o plata esuata.
   * Arunca `NotFoundError` daca plata nu exista si `ConflictError(PAYMENT_CHANGED)` daca statusul s-a schimbat intre timp.
   */
  update(payment: Payment, expectedStatus: PaymentStatus): Promise<void>;
}
