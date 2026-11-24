import type { Clock } from '../../../../../shared';
import type { PaymentGateway } from '../../../ports/out/PaymentGateway';
import type { PaymentProviderFactory } from '../../../ports/out/PaymentProviderFactory';
import type { RefundProcessor } from '../../../ports/out/RefundProcessor';
import type { WebhookVerifier } from '../../../ports/out/WebhookVerifier';
import { PayPalGateway } from './PayPalGateway';
import type { PayPalMockClient } from './PayPalMockClient';
import { PayPalRefundProcessor } from './PayPalRefundProcessor';
import { PayPalWebhookVerifier } from './PayPalWebhookVerifier';

// Pattern: Abstract Factory (Creational) – fabrica concreta PayPal: gateway + rambursari (cu fereastra PayPal) + verificator de webhook-uri, toate peste acelasi client si secret
export class PayPalFactory implements PaymentProviderFactory {
  readonly provider = 'PAYPAL';
  readonly method = 'PAYPAL';

  constructor(
    private readonly client: PayPalMockClient,
    private readonly webhookSecret: string,
    private readonly clock: Clock,
  ) {}

  createGateway(): PaymentGateway {
    return new PayPalGateway(this.client);
  }

  createRefundProcessor(): RefundProcessor {
    return new PayPalRefundProcessor(this.createGateway(), this.clock);
  }

  createWebhookVerifier(): WebhookVerifier {
    return new PayPalWebhookVerifier(this.webhookSecret, this.clock);
  }
}
