import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS } from '../../../src/modules/ordering/domain/OrderItem';
import { makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';
import {
  PLACE_INPUT,
  admin,
  buildOrderingHarness,
  customer,
  type HarnessOptions,
} from '../../helpers/ordering-harness';

const KEYBOARD = uuid(1);
const MOUSE = uuid(2);
const ana = customer(1);

const POLICY = {
  vatPercent: 19,
  discountTiers: [
    { minSubtotalCents: 50_000, percent: 5 },
    { minSubtotalCents: 100_000, percent: 10 },
  ],
};

/** Harness cu o tastatura de 100.00 RON (stoc 5) si un mouse de 25.50 RON (stoc 3). */
async function harness(options: HarnessOptions = {}) {
  const h = buildOrderingHarness(options);
  await h.products.save(makeProduct({ id: KEYBOARD, name: 'Tastatura', amount: 10_000, stock: 5 }));
  await h.products.save(makeProduct({ id: MOUSE, name: 'Mouse', amount: 2_550, stock: 3 }));
  return h;
}

describe('plasarea comenzii cu pret calculat (Decorator in flux)', () => {
  it('fara reguli de pret, totalul este suma liniilor', async () => {
    const h = await harness();
    await h.cart.addItem(ana.userId, KEYBOARD, 2);
    const order = await h.service.placeOrder(ana, PLACE_INPUT);
    expect(order.price.discount.amount).toBe(0);
    expect(order.price.vat.amount).toBe(0);
    expect(order.total.amount).toBe(20_000);
  });

  it('sub primul prag: doar TVA', async () => {
    const h = await harness({ pricing: POLICY });
    await h.cart.addItem(ana.userId, KEYBOARD, 2); // 200.00
    const order = await h.service.placeOrder(ana, PLACE_INPUT);
    expect(order.price.subtotal.amount).toBe(20_000);
    expect(order.price.discount.amount).toBe(0);
    expect(order.price.vat.amount).toBe(3_800);
    expect(order.total.amount).toBe(23_800);
  });

  it('peste un prag: reducere, apoi TVA pe subtotalul redus; rezultatul se pastreaza in comanda salvata', async () => {
    const h = await harness({ pricing: POLICY });
    await h.cart.addItem(ana.userId, KEYBOARD, 5); // 500.00 -> prag 5%
    const order = await h.service.placeOrder(ana, PLACE_INPUT);

    expect(order.price.subtotal.amount).toBe(50_000);
    expect(order.price.discount.amount).toBe(2_500);
    expect(order.price.vat.amount).toBe(9_025); // 19% din 475.00
    expect(order.total.amount).toBe(56_525);

    const stored = await h.service.getOrder(ana, order.id);
    expect(stored.price.subtotal.amount).toBe(50_000);
    expect(stored.price.discount.amount).toBe(2_500);
    expect(stored.price.vat.amount).toBe(9_025);
    expect(stored.total.amount).toBe(56_525);
  });

  it('pretul cu reducere si TVA ramane in comanda si dupa schimbari de stare', async () => {
    const h = await harness({ pricing: POLICY });
    await h.cart.addItem(ana.userId, KEYBOARD, 5);
    const order = await h.service.placeOrder(ana, PLACE_INPUT);
    const paid = await h.service.changeStatus(admin, order.id, 'PAID');
    expect(paid.total.amount).toBe(56_525);
    expect(paid.price.discount.amount).toBe(2_500);
  });

  it('un total care cu TVA depaseste limita INTEGER e refuzat cu INVALID_ORDER, fara sa schimbe stocul', async () => {
    const h = await harness({ pricing: { vatPercent: 19, discountTiers: [] } });
    await h.products.save(
      makeProduct({ id: uuid(3), name: 'Scump', amount: 1_000_000_000, stock: 5 }),
    );
    await h.cart.addItem(ana.userId, uuid(3), 2); // subtotal 2.000.000.000: incape; cu TVA (2.380.000.000) nu
    await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
      code: 'INVALID_ORDER',
    });
    expect(await h.stockOf(uuid(3))).toBe(5);
    expect(MAX_AMOUNT_CENTS).toBe(2_147_483_647);
  });
});

describe('lantul de validare in plasarea comenzii (Chain of Responsibility in flux)', () => {
  let h: Awaited<ReturnType<typeof harness>>;

  const expectUntouched = async (stock = 5) => {
    expect(await h.stockOf(KEYBOARD)).toBe(stock);
    expect((await h.cart.getCart(ana.userId)).itemCount).toBeGreaterThan(0);
    expect(
      (await h.orders.findByCustomerId({ customerId: ana.userId, limit: 10, offset: 0 })).total,
    ).toBe(0);
    expect(h.published).toEqual([]);
  };

  beforeEach(async () => {
    h = await harness({
      allowedCountries: ['MD'],
      maxOrderAmountCents: 30_000,
      fraud: { maxOrdersPerWindow: 2, windowMs: 60_000, suspiciousAmountCents: 25_000 },
    });
  });

  it('o comanda care trece toate verigile se plaseaza', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 1);
    expect((await h.service.placeOrder(ana, PLACE_INPUT)).status).toBe('NEW');
  });

  it('tara nelivrabila: 422 UNSUPPORTED_COUNTRY, nimic nu se schimba', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 1);
    await expect(
      h.service.placeOrder(ana, {
        ...PLACE_INPUT,
        address: { ...PLACE_INPUT.address, country: 'US' },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_COUNTRY' });
    await expectUntouched();
  });

  it('suma peste limita: 422 AMOUNT_LIMIT_EXCEEDED (inaintea verigii anti-frauda, care are prag mai mic)', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 4); // 400.00 > limita 300.00 (si > pragul de frauda 250.00)
    await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
      code: 'AMOUNT_LIMIT_EXCEEDED',
    });
    await expectUntouched();
  });

  it('suma neobisnuita (sub limita, peste pragul de frauda): 422 ORDER_FLAGGED', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 3); // 300.00: la limita, dar peste pragul de frauda (250.00)
    await expect(h.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
      code: 'ORDER_FLAGGED',
    });
    await expectUntouched();
  });

  it('o suma sub pragul de frauda trece', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 2);
    await h.cart.addItem(ana.userId, MOUSE, 1); // 225.50
    await expect(h.service.placeOrder(ana, PLACE_INPUT)).resolves.toBeDefined();
  });

  it('stoc insuficient: 409 INSUFFICIENT_STOCK, prima veriga din lant', async () => {
    await h.cart.addItem(ana.userId, KEYBOARD, 3);
    const product = await h.products.findById(KEYBOARD);
    await h.products.save(product!.withChanges({ stock: 1 }));
    await expect(
      h.service.placeOrder(ana, {
        ...PLACE_INPUT,
        address: { ...PLACE_INPUT.address, country: 'US' }, // ar pica si la adresa, dar stocul e inaintea ei
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('prea multe comenzi intr-un interval scurt: 429 ORDER_RATE_LIMITED; dupa fereastra se poate din nou', async () => {
    let now = new Date();
    const limited = await harness({
      fraud: { maxOrdersPerWindow: 2, windowMs: 60_000 },
      clock: () => now,
    });
    for (let i = 0; i < 2; i++) {
      await limited.cart.addItem(ana.userId, MOUSE, 1);
      await limited.service.placeOrder(ana, PLACE_INPUT);
    }
    await limited.cart.addItem(ana.userId, MOUSE, 1);
    await expect(limited.service.placeOrder(ana, PLACE_INPUT)).rejects.toMatchObject({
      code: 'ORDER_RATE_LIMITED',
      name: 'TooManyRequestsError',
    });
    expect(await limited.stockOf(MOUSE)).toBe(1); // a treia comanda nu a scazut stocul

    now = new Date(Date.now() + 61_000); // fereastra a trecut
    await expect(limited.service.placeOrder(ana, PLACE_INPUT)).resolves.toBeDefined();
  });

  it('limita de frecventa e pe client: un alt client nu e afectat', async () => {
    const limited = await harness({ fraud: { maxOrdersPerWindow: 1, windowMs: 60_000 } });
    await limited.cart.addItem(ana.userId, MOUSE, 1);
    await limited.service.placeOrder(ana, PLACE_INPUT);
    const bob = customer(2);
    await limited.cart.addItem(bob.userId, MOUSE, 1);
    await expect(limited.service.placeOrder(bob, PLACE_INPUT)).resolves.toBeDefined();
  });
});
