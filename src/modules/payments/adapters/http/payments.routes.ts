import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import { idParamsSchema } from '../../../../infrastructure/http/common-schemas';
import type { Payment } from '../../domain/Payment';
import type {
  GetOrderPaymentUseCase,
  PayOrderUseCase,
  PaymentWebhookUseCase,
} from '../../ports/in/PaymentUseCases';
import {
  webhookParamsSchema,
  type paymentResponseSchema,
  type webhookResponseSchema,
} from './payments.schemas';

export interface PaymentsRouterDependencies {
  readonly payOrder: PayOrderUseCase;
  readonly getOrderPayment: GetOrderPaymentUseCase;
  readonly webhooks: PaymentWebhookUseCase;
  /** Plata si starea ei cer autentificare; webhook-ul nu (il autentifica semnatura furnizorului). */
  readonly requireAuth: RequestHandler;
}

export function toPaymentResponse(payment: Payment): z.infer<typeof paymentResponseSchema> {
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount.toJSON(),
    externalId: payment.externalId,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

/** Adaptor inbound REST pentru plati: plata unei comenzi, starea ei si webhook-urile furnizorilor. */
export function createPaymentsRouter({
  payOrder,
  getOrderPayment,
  webhooks,
  requireAuth,
}: PaymentsRouterDependencies): Router {
  const router = Router();

  router.post('/orders/:id/payment', requireAuth, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(201).json(toPaymentResponse(await payOrder.execute(principalOf(req), id)));
  });

  router.get('/orders/:id/payment', requireAuth, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(toPaymentResponse(await getOrderPayment.execute(principalOf(req), id)));
  });

  router.post('/payments/webhooks/:provider', async (req, res) => {
    const { provider } = webhookParamsSchema.parse(req.params);
    // Semnatura se verifica pe corpul exact primit (`rawBody`), nu pe JSON-ul re-serializat.
    const outcome = await webhooks.handle(provider, req.rawBody ?? Buffer.alloc(0), req.headers);
    const body: z.infer<typeof webhookResponseSchema> = { received: true, ...outcome };
    res.json(body);
  });

  return router;
}
