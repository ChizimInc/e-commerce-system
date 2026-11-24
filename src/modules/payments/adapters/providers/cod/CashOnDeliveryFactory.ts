import { GatewayRefundProcessor } from '../../../application/GatewayRefundProcessor';
import type { PaymentGateway } from '../../../ports/out/PaymentGateway';
import type { PaymentProviderFactory } from '../../../ports/out/PaymentProviderFactory';
import type { RefundProcessor } from '../../../ports/out/RefundProcessor';
import type { WebhookVerifier } from '../../../ports/out/WebhookVerifier';
import { CashOnDeliveryGateway } from './CashOnDeliveryGateway';
import { CashOnDeliveryWebhookVerifier } from './CashOnDeliveryWebhookVerifier';
import type { CourierCodApi } from './CourierCodApi';

// Pattern: Abstract Factory (Creational) – fabrica concreta de ramburs (CASH_ON_DELIVERY): gateway + rambursari + verificator de webhook-uri ale curierului, peste acelasi API si secret
export class CashOnDeliveryFactory implements PaymentProviderFactory {
  readonly provider = 'COD';
  readonly method = 'CASH_ON_DELIVERY';

  constructor(
    private readonly api: CourierCodApi,
    private readonly webhookSecret: string,
  ) {}

  createGateway(): PaymentGateway {
    return new CashOnDeliveryGateway(this.api);
  }

  createRefundProcessor(): RefundProcessor {
    return new GatewayRefundProcessor(this.createGateway());
  }

  createWebhookVerifier(): WebhookVerifier {
    return new CashOnDeliveryWebhookVerifier(this.webhookSecret);
  }
}
