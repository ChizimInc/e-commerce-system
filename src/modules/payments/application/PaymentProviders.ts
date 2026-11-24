import { DomainError } from '../../../shared';
import type { PaymentMethod, PaymentProvider } from '../domain/PaymentTypes';
import type { PaymentGateway } from '../ports/out/PaymentGateway';
import type { PaymentProviderFactory } from '../ports/out/PaymentProviderFactory';
import type { RefundProcessor } from '../ports/out/RefundProcessor';
import type { WebhookVerifier } from '../ports/out/WebhookVerifier';
import type {
  AbstractPaymentProcessor,
  PaymentProcessorDependencies,
} from './AbstractPaymentProcessor';
import { CashOnDeliveryPaymentProcessor } from './processors/CashOnDeliveryPaymentProcessor';
import { PayPalPaymentProcessor } from './processors/PayPalPaymentProcessor';
import { StripePaymentProcessor } from './processors/StripePaymentProcessor';

/** Tot ce trebuie aplicatiei pentru un furnizor: familia creata de fabrica lui + procesorul (Template Method) peste gateway-ul ei. */
export interface ProviderServices {
  readonly provider: PaymentProvider;
  readonly method: PaymentMethod;
  readonly gateway: PaymentGateway;
  readonly refunds: RefundProcessor;
  readonly webhooks: WebhookVerifier;
  readonly processor: AbstractPaymentProcessor;
}

type ProcessorClass = new (dependencies: PaymentProcessorDependencies) => AbstractPaymentProcessor;

/** Subclasa Template Method a fiecarui furnizor; `Record` obliga sa fie listat orice furnizor nou. */
const PROCESSORS: Record<PaymentProvider, ProcessorClass> = {
  STRIPE: StripePaymentProcessor,
  PAYPAL: PayPalPaymentProcessor,
  COD: CashOnDeliveryPaymentProcessor,
};

/**
 * Clientul fabricilor abstracte: alege furnizorul dupa metoda de plata a comenzii (sau dupa numele lui, pentru
 * webhook-uri) si ii construieste o singura data familia. Un furnizor nou se adauga cu o fabrica noua, fara sa
 * se modifice cazurile de utilizare.
 */
export class PaymentProviders {
  private readonly byMethod = new Map<PaymentMethod, ProviderServices>();
  private readonly byProvider = new Map<PaymentProvider, ProviderServices>();

  constructor(
    factories: readonly PaymentProviderFactory[],
    dependencies: Omit<PaymentProcessorDependencies, 'gateway'>,
  ) {
    for (const factory of factories) {
      if (this.byProvider.has(factory.provider) || this.byMethod.has(factory.method)) {
        throw new Error(`Furnizor de plata inregistrat de doua ori: ${factory.provider}`);
      }
      const gateway = factory.createGateway();
      const services: ProviderServices = {
        provider: factory.provider,
        method: factory.method,
        gateway,
        refunds: factory.createRefundProcessor(),
        webhooks: factory.createWebhookVerifier(),
        processor: new PROCESSORS[factory.provider]({ ...dependencies, gateway }),
      };
      this.byProvider.set(factory.provider, services);
      this.byMethod.set(factory.method, services);
    }
  }

  forMethod(method: PaymentMethod): ProviderServices {
    const services = this.byMethod.get(method);
    if (!services) {
      throw new DomainError(
        `Nicio integrare de plata pentru metoda ${method}`,
        'PAYMENT_METHOD_UNSUPPORTED',
      );
    }
    return services;
  }

  forProvider(provider: PaymentProvider): ProviderServices {
    const services = this.byProvider.get(provider);
    if (!services) {
      throw new DomainError(
        `Furnizor de plata necunoscut: ${provider}`,
        'PAYMENT_PROVIDER_UNSUPPORTED',
      );
    }
    return services;
  }
}
