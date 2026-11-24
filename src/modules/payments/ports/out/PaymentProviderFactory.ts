import type { PaymentMethod, PaymentProvider } from '../../domain/PaymentTypes';
import type { PaymentGateway } from './PaymentGateway';
import type { RefundProcessor } from './RefundProcessor';
import type { WebhookVerifier } from './WebhookVerifier';

// Pattern: Abstract Factory (Creational) – interfata fabricii abstracte: creeaza familia de componente a unui furnizor de plata
/**
 * Fabrica abstracta de furnizori: fiecare implementare concreta (`StripeFactory`, `PayPalFactory`,
 * `CashOnDeliveryFactory`) creeaza o familie COMPATIBILA — gateway, procesor de rambursari si verificator de
 * webhook-uri ale aceluiasi furnizor, deci componentele unui furnizor nu se pot amesteca cu ale altuia.
 */
export interface PaymentProviderFactory {
  readonly provider: PaymentProvider;
  /** Metoda de plata a comenzii pe care o deserveste acest furnizor. */
  readonly method: PaymentMethod;
  createGateway(): PaymentGateway;
  createRefundProcessor(): RefundProcessor;
  createWebhookVerifier(): WebhookVerifier;
}
