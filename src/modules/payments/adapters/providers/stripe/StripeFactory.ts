import type { Clock } from '../../../../../shared';
import { GatewayRefundProcessor } from '../../../application/GatewayRefundProcessor';
import type { PaymentGateway } from '../../../ports/out/PaymentGateway';
import type { PaymentProviderFactory } from '../../../ports/out/PaymentProviderFactory';
import type { RefundProcessor } from '../../../ports/out/RefundProcessor';
import type { WebhookVerifier } from '../../../ports/out/WebhookVerifier';
import { StripeGateway } from './StripeGateway';
import type { StripeMockApi } from './StripeMockApi';
import { StripeWebhookVerifier } from './StripeWebhookVerifier';

// Pattern: Abstract Factory (Creational) – fabrica concreta Stripe (CARD): gateway + rambursari + verificator de webhook-uri, toate peste acelasi API si secret
export class StripeFactory implements PaymentProviderFactory {
  readonly provider = 'STRIPE';
  readonly method = 'CARD';

  constructor(
    private readonly api: StripeMockApi,
    private readonly webhookSecret: string,
    private readonly clock: Clock,
  ) {}

  createGateway(): PaymentGateway {
    return new StripeGateway(this.api);
  }

  createRefundProcessor(): RefundProcessor {
    return new GatewayRefundProcessor(this.createGateway());
  }

  createWebhookVerifier(): WebhookVerifier {
    return new StripeWebhookVerifier(this.webhookSecret, this.clock);
  }
}
