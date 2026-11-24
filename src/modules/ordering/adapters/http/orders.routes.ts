import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import { idParamsSchema } from '../../../../infrastructure/http/common-schemas';
import type { Order } from '../../domain/Order';
import type { OrderPage, OrderUseCases } from '../../ports/in/OrderUseCases';
import {
  changeOrderStatusSchema,
  listOrdersQuerySchema,
  placeOrderSchema,
  type orderPageResponseSchema,
  type orderResponseSchema,
} from './orders.schemas';

export interface OrdersRouterDependencies {
  readonly orders: OrderUseCases;
  /** Toate rutele comenzilor cer autentificare. */
  readonly requireAuth: RequestHandler;
  /** Garda pentru rutele de administrare (rol ADMIN). */
  readonly requireAdmin: RequestHandler;
}

export function toOrderResponse(order: Order): z.infer<typeof orderResponseSchema> {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    items: order.items.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      unitPrice: item.unitPrice.toJSON(),
      quantity: item.quantity,
      lineTotal: item.lineTotal().toJSON(),
    })),
    total: order.total.toJSON(),
    address: order.address.toJSON(),
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
  };
}

function toOrderPageResponse(page: OrderPage): z.infer<typeof orderPageResponseSchema> {
  return {
    items: page.items.map(toOrderResponse),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

/** Adaptor inbound REST pentru comenzi. Clientul vede doar comenzile lui; identitatea vine din token. */
export function createOrdersRouter({
  orders,
  requireAuth,
  requireAdmin,
}: OrdersRouterDependencies): Router {
  const router = Router();
  router.use('/orders', requireAuth);

  router.post('/orders', async (req, res) => {
    const input = placeOrderSchema.parse(req.body);
    res.status(201).json(toOrderResponse(await orders.placeOrder(principalOf(req), input)));
  });

  router.get('/orders', async (req, res) => {
    const query = listOrdersQuerySchema.parse(req.query);
    res.json(toOrderPageResponse(await orders.listMyOrders(principalOf(req), query)));
  });

  router.get('/orders/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(toOrderResponse(await orders.getOrder(principalOf(req), id)));
  });

  router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const { status } = changeOrderStatusSchema.parse(req.body);
    res.json(toOrderResponse(await orders.changeStatus(principalOf(req), id, status)));
  });

  return router;
}
