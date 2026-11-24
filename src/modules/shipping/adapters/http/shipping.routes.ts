import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import { idParamsSchema } from '../../../../infrastructure/http/common-schemas';
import type { Shipment } from '../../domain/Shipment';
import type {
  CartShippingQuote,
  GetOrderShipmentUseCase,
  QuoteShippingUseCase,
  ShipOrderUseCase,
} from '../../ports/in/ShippingUseCases';
import type { shipmentResponseSchema, shippingQuoteResponseSchema } from './shipping.schemas';

export interface ShippingRouterDependencies {
  readonly shipOrder: ShipOrderUseCase;
  readonly getOrderShipment: GetOrderShipmentUseCase;
  readonly quoteShipping: QuoteShippingUseCase;
  /** Starea livrarii si cotatia cer autentificare. */
  readonly requireAuth: RequestHandler;
  /** Expedierea cere rolul ADMIN. */
  readonly requireAdmin: RequestHandler;
}

export function toShipmentResponse(shipment: Shipment): z.infer<typeof shipmentResponseSchema> {
  return {
    id: shipment.id,
    orderId: shipment.orderId,
    courier: shipment.courier,
    status: shipment.status,
    cost: shipment.cost.toJSON(),
    externalId: shipment.externalId,
    trackingNumber: shipment.trackingNumber,
    failureReason: shipment.failureReason,
    createdAt: shipment.createdAt.toISOString(),
    updatedAt: shipment.updatedAt.toISOString(),
  };
}

function toQuoteResponse(quote: CartShippingQuote): z.infer<typeof shippingQuoteResponseSchema> {
  return {
    itemsValue: quote.itemsValue.toJSON(),
    units: quote.units,
    options: quote.options.map(({ deliveryMethod, courier, cost }) => ({
      deliveryMethod,
      courier,
      cost: cost.toJSON(),
    })),
  };
}

/** Adaptor inbound REST pentru livrari: expedierea (ADMIN), starea livrarii si cotatia costului inainte de checkout. */
export function createShippingRouter({
  shipOrder,
  getOrderShipment,
  quoteShipping,
  requireAuth,
  requireAdmin,
}: ShippingRouterDependencies): Router {
  const router = Router();

  router.post('/orders/:id/shipment', requireAdmin, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(201).json(toShipmentResponse(await shipOrder.execute(principalOf(req), id)));
  });

  router.get('/orders/:id/shipment', requireAuth, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(toShipmentResponse(await getOrderShipment.execute(principalOf(req), id)));
  });

  router.get('/shipping/quote', requireAuth, async (req, res) => {
    res.json(toQuoteResponse(await quoteShipping.quoteCart(principalOf(req))));
  });

  return router;
}
