import { Router, type RequestHandler } from 'express';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import type { PricedCart } from '../../domain/PricedCart';
import type { CartUseCases } from '../../ports/in/CartUseCases';
import {
  addCartItemSchema,
  cartItemParamsSchema,
  updateCartItemSchema,
  type cartResponseSchema,
} from './cart.schemas';

export interface CartRouterDependencies {
  readonly cart: CartUseCases;
  /** Middleware care cere autentificare: toate rutele cosului sunt private. */
  readonly requireAuth: RequestHandler;
}

export function toCartResponse(cart: PricedCart): z.infer<typeof cartResponseSchema> {
  return {
    items: cart.lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      unitPrice: line.unitPrice.toJSON(),
      quantity: line.quantity,
      lineTotal: line.lineTotal.toJSON(),
      availableStock: line.availableStock,
      inStock: line.inStock,
    })),
    itemCount: cart.itemCount,
    total: cart.total.toJSON(),
  };
}

/** Adaptor inbound REST pentru cos. Cosul este al utilizatorului din token (nu exista id de cos in URL). */
export function createCartRouter({ cart, requireAuth }: CartRouterDependencies): Router {
  const router = Router();
  router.use('/cart', requireAuth);

  router.get('/cart', async (req, res) => {
    res.json(toCartResponse(await cart.getCart(principalOf(req).userId)));
  });

  router.post('/cart/items', async (req, res) => {
    const { itemId, quantity } = addCartItemSchema.parse(req.body);
    res.json(toCartResponse(await cart.addItem(principalOf(req).userId, itemId, quantity)));
  });

  router.patch('/cart/items/:itemId', async (req, res) => {
    const { itemId } = cartItemParamsSchema.parse(req.params);
    const { quantity } = updateCartItemSchema.parse(req.body);
    res.json(toCartResponse(await cart.updateQuantity(principalOf(req).userId, itemId, quantity)));
  });

  router.delete('/cart/items/:itemId', async (req, res) => {
    const { itemId } = cartItemParamsSchema.parse(req.params);
    res.json(toCartResponse(await cart.removeItem(principalOf(req).userId, itemId)));
  });

  router.delete('/cart', async (req, res) => {
    res.json(toCartResponse(await cart.clear(principalOf(req).userId)));
  });

  return router;
}
