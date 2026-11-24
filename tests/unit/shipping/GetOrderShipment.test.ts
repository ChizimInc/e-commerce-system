import { beforeEach, describe, expect, it } from 'vitest';
import { CourierProviderError } from '../../../src/modules/shipping/domain/errors';
import { DomainError } from '../../../src/shared';
import { uuid } from '../../helpers/ids';
import {
  admin,
  buildShippingHarness,
  owner,
  stranger,
  type ShippingHarness,
} from '../../helpers/shipping-harness';

const ORDER = uuid(1);

describe('GetOrderShipment (starea livrarii + urmarire)', () => {
  let h: ShippingHarness;

  beforeEach(async () => {
    h = buildShippingHarness();
    h.newOrder(1);
    await h.shipOrder.execute(admin, ORDER);
  });

  it('proprietarul si ADMIN vad livrarea', async () => {
    expect(await h.getOrderShipment.execute(owner, ORDER)).toMatchObject({ orderId: ORDER });
    expect(await h.getOrderShipment.execute(admin, ORDER)).toMatchObject({ orderId: ORDER });
  });

  it('comanda altcuiva e NotFound (nu Forbidden), ca sa nu confirme ca exista', async () => {
    await expect(h.getOrderShipment.execute(stranger, ORDER)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('o comanda inexistenta sau fara livrare e NotFound', async () => {
    await expect(h.getOrderShipment.execute(admin, uuid(404))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    h.newOrder(2);
    await expect(h.getOrderShipment.execute(owner, uuid(2))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reimprospateaza starea din urmarirea curierului si o salveaza', async () => {
    h.services.FAST_COURIER.trackStatus = 'IN_TRANSIT';

    const shipment = await h.getOrderShipment.execute(owner, ORDER);

    expect(shipment.status).toBe('IN_TRANSIT');
    expect(h.services.FAST_COURIER.tracked).toEqual(['FC-1']);
    expect((await h.shipments.findByOrderId(ORDER))?.status).toBe('IN_TRANSIT');
  });

  it('un colet livrat e final: nu se mai intreaba curierul', async () => {
    h.services.FAST_COURIER.trackStatus = 'DELIVERED';
    await h.getOrderShipment.execute(owner, ORDER);
    h.services.FAST_COURIER.tracked.length = 0;

    const again = await h.getOrderShipment.execute(owner, ORDER);

    expect(again.status).toBe('DELIVERED');
    expect(h.services.FAST_COURIER.tracked).toEqual([]);
  });

  it('daca curierul nu raspunde, se intoarce ultima stare salvata (urmarirea e informativa)', async () => {
    h.services.FAST_COURIER.trackError = new CourierProviderError('cazut');

    const shipment = await h.getOrderShipment.execute(owner, ORDER);

    expect(shipment.status).toBe('CREATED');
  });

  it('un raspuns mai vechi decat starea salvata nu da livrarea inapoi', async () => {
    h.services.FAST_COURIER.trackStatus = 'IN_TRANSIT';
    await h.getOrderShipment.execute(owner, ORDER);
    h.services.FAST_COURIER.trackStatus = 'CREATED';

    expect((await h.getOrderShipment.execute(owner, ORDER)).status).toBe('IN_TRANSIT');
  });

  it('o livrare esuata sau in curs nu se urmareste la curier', async () => {
    h.newOrder(3);
    h.services.FAST_COURIER.createError = new CourierProviderError('cazut');
    await expect(h.shipOrder.execute(admin, uuid(3))).rejects.toBeInstanceOf(DomainError);
    h.services.FAST_COURIER.tracked.length = 0;

    const failed = await h.getOrderShipment.execute(admin, uuid(3));

    expect(failed.status).toBe('FAILED');
    expect(h.services.FAST_COURIER.tracked).toEqual([]);
  });
});

describe('QuoteCartShipping (costul inainte de checkout)', () => {
  it('intoarce costul fiecarei metode de livrare pentru cosul curent, impreuna cu curierul ei', async () => {
    const h = buildShippingHarness();

    const quote = await h.quoteCart.quoteCart(owner);

    expect(quote.units).toBe(2);
    expect(quote.itemsValue.amount).toBe(10_000);
    expect(
      quote.options.map(({ deliveryMethod, courier, cost }) => [
        deliveryMethod,
        courier,
        cost.amount,
      ]),
    ).toEqual([
      ['STANDARD', 'POST_OFFICE', 1_500],
      ['EXPRESS', 'FAST_COURIER', 3_200],
      ['STORE_PICKUP', 'STORE_PICKUP', 0],
    ]);
  });

  it('standardul devine gratuit de la pragul de valoare a marfii', async () => {
    const h = buildShippingHarness();
    h.cart.basis = {
      itemsValue: h.cart.basis.itemsValue.add(h.cart.basis.itemsValue).multiply(10),
      units: 2,
    };

    const quote = await h.quoteCart.quoteCart(owner);

    expect(quote.options.find((o) => o.deliveryMethod === 'STANDARD')?.cost.amount).toBe(0);
  });

  it('un cos gol nu are cotatie (CART_EMPTY)', async () => {
    const h = buildShippingHarness();
    h.cart.basis = {
      itemsValue: h.cart.basis.itemsValue.subtract(h.cart.basis.itemsValue),
      units: 0,
    };

    await expect(h.quoteCart.quoteCart(owner)).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });
});
