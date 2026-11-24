import { CartServiceSource } from '../../src/modules/ordering/adapters/cart/CartServiceSource';
import { CatalogOrderLookup } from '../../src/modules/ordering/adapters/catalog/CatalogOrderLookup';
import { InMemoryOrderPlacement } from '../../src/modules/ordering/adapters/persistence/InMemoryOrderPlacement';
import { InMemoryOrderRepository } from '../../src/modules/ordering/adapters/persistence/InMemoryOrderRepository';
import { InMemoryStockRestoration } from '../../src/modules/ordering/adapters/persistence/InMemoryStockRestoration';
import { OrderService } from '../../src/modules/ordering/application/OrderService';
import { RestockOnOrderCancelled } from '../../src/modules/ordering/application/RestockOnOrderCancelled';
import { chainOf } from '../../src/modules/ordering/application/validation/CheckoutValidator';
import {
  AddressValidator,
  AmountLimitValidator,
  FraudCheckValidator,
  StockValidator,
  type FraudRules,
} from '../../src/modules/ordering/application/validation/validators';
import {
  ORDER_EVENT_TYPES,
  type OrderEvent,
} from '../../src/modules/ordering/domain/events/OrderEvents';
import { MAX_AMOUNT_CENTS } from '../../src/modules/ordering/domain/OrderItem';
import {
  NO_PRICE_MODIFIERS,
  type PricingPolicy,
} from '../../src/modules/ordering/domain/pricing/PricingPolicy';
import type { PlaceOrderInput } from '../../src/modules/ordering/ports/in/OrderUseCases';
import { CatalogItemLookup } from '../../src/modules/cart/adapters/catalog/CatalogItemLookup';
import { InMemoryCartRepository } from '../../src/modules/cart/adapters/persistence/InMemoryCartRepository';
import { CartService } from '../../src/modules/cart/application/CartService';
import { InMemoryBundleRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryCategoryRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryCategoryRepository';
import { InMemoryProductRepository } from '../../src/modules/catalog/adapters/persistence/InMemoryProductRepository';
import { CatalogQueryService } from '../../src/modules/catalog/application/CatalogQueryService';
import { Bundle } from '../../src/modules/catalog/domain/Bundle';
import { InMemoryEventBus, type EventBus, type Principal } from '../../src/shared';
import { ADDRESS_PROPS } from './order-fixtures';
import { SequentialIdGenerator, uuid } from './ids';
import { silentLogger } from './silent-logger';

export const customer = (n: number): Principal => ({ userId: uuid(900 + n), role: 'CUSTOMER' });
export const admin: Principal = { userId: uuid(990), role: 'ADMIN' };

export const PLACE_INPUT: PlaceOrderInput = {
  address: ADDRESS_PROPS,
  deliveryMethod: 'STANDARD',
  paymentMethod: 'CARD',
};

export interface HarnessOptions {
  pricing?: PricingPolicy;
  allowedCountries?: readonly string[];
  maxOrderAmountCents?: number;
  fraud?: Partial<FraudRules>;
  /** Ceasul regulii anti-frauda (implicit ceasul real). */
  clock?: () => Date;
  /** Magistrala de evenimente (implicit in-memory); un test poate pune una defecta. */
  events?: EventBus;
}

/** Modulul `ordering` asamblat pe adaptoare in-memory, impreuna cu catalogul si cosul de care depinde. */
export function buildOrderingHarness(options: HarnessOptions = {}) {
  const products = new InMemoryProductRepository();
  const bundles = new InMemoryBundleRepository(products);
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  const catalog = new CatalogQueryService(products, new InMemoryCategoryRepository(), bundles);
  const cart = new CartService(
    carts,
    new CatalogItemLookup(catalog),
    new SequentialIdGenerator(2000),
  );
  const placement = new InMemoryOrderPlacement(orders, products, carts);
  const orderCatalog = new CatalogOrderLookup(catalog);
  const restoration = new InMemoryStockRestoration(products);

  // Aceeasi asamblare ca in composition root: lant de validare + magistrala de evenimente cu abonatul de repunere a stocului.
  const validation = chainOf(
    new StockValidator(),
    new AddressValidator(options.allowedCountries ?? ['MD', 'RO']),
    new AmountLimitValidator(options.maxOrderAmountCents ?? MAX_AMOUNT_CENTS),
    new FraudCheckValidator(
      orders,
      {
        maxOrdersPerWindow: 1000,
        windowMs: 60_000,
        suspiciousAmountCents: MAX_AMOUNT_CENTS,
        ...options.fraud,
      },
      options.clock,
    ),
  );
  const events = options.events ?? new InMemoryEventBus(silentLogger);
  const published: OrderEvent[] = [];
  for (const type of ORDER_EVENT_TYPES) {
    events.subscribe<OrderEvent>(type, (event) => {
      published.push(event);
    });
  }
  const restock = new RestockOnOrderCancelled(orderCatalog, restoration, silentLogger);
  restock.register(events);

  const service = new OrderService(
    orders,
    new CartServiceSource(cart),
    orderCatalog,
    placement,
    validation,
    options.pricing ?? NO_PRICE_MODIFIERS,
    events,
    new SequentialIdGenerator(5000),
    silentLogger,
  );

  const stockOf = async (productId: string): Promise<number> =>
    (await products.findById(productId))?.stock ?? -1;

  const saveBundle = async (
    id: string,
    parts: { productId: string; quantity: number }[],
    discountPercent = 0,
  ): Promise<void> => {
    const components = await Promise.all(
      parts.map(async ({ productId, quantity }) => {
        const item = await products.findById(productId);
        if (!item) throw new Error(`produs lipsa ${productId}`);
        return { item, quantity };
      }),
    );
    await bundles.save(
      Bundle.create({ id, name: 'Pachet', description: '', discountPercent, components }),
    );
  };

  return {
    products,
    bundles,
    carts,
    orders,
    cart,
    placement,
    restoration,
    restock,
    events,
    published,
    service,
    stockOf,
    saveBundle,
  };
}

export type OrderingHarness = ReturnType<typeof buildOrderingHarness>;
