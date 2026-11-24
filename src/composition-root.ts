import type { Express } from 'express';
import type { Config } from './config';
import { createApp } from './infrastructure/http/app';
import { createAuthentication } from './infrastructure/http/authentication';
import { createPrismaClient, type PrismaClient } from './infrastructure/persistence/prisma-client';
import { CatalogItemLookup } from './modules/cart/adapters/catalog/CatalogItemLookup';
import { createCartRouter } from './modules/cart/adapters/http/cart.routes';
import { InMemoryCartRepository } from './modules/cart/adapters/persistence/InMemoryCartRepository';
import { PrismaCartRepository } from './modules/cart/adapters/persistence/PrismaCartRepository';
import { CartService } from './modules/cart/application/CartService';
import type { CartRepository } from './modules/cart/ports/out/CartRepository';
import { createCatalogRouter } from './modules/catalog/adapters/http/catalog.routes';
import { CachingProductRepository } from './modules/catalog/adapters/persistence/CachingProductRepository';
import { InMemoryBundleRepository } from './modules/catalog/adapters/persistence/InMemoryBundleRepository';
import { InMemoryCategoryRepository } from './modules/catalog/adapters/persistence/InMemoryCategoryRepository';
import { InMemoryProductRepository } from './modules/catalog/adapters/persistence/InMemoryProductRepository';
import { PrismaBundleRepository } from './modules/catalog/adapters/persistence/PrismaBundleRepository';
import { PrismaCategoryRepository } from './modules/catalog/adapters/persistence/PrismaCategoryRepository';
import { PrismaProductRepository } from './modules/catalog/adapters/persistence/PrismaProductRepository';
import { AuthorizationProxy } from './modules/catalog/application/AuthorizationProxy';
import { CatalogAdminUseCases } from './modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from './modules/catalog/application/CatalogQueryService';
import type { BundleRepository } from './modules/catalog/ports/out/BundleRepository';
import type { CategoryRepository } from './modules/catalog/ports/out/CategoryRepository';
import type { ProductRepository } from './modules/catalog/ports/out/ProductRepository';
import { createAuthRouter } from './modules/identity/adapters/http/auth.routes';
import { InMemoryUserRepository } from './modules/identity/adapters/persistence/InMemoryUserRepository';
import { PrismaUserRepository } from './modules/identity/adapters/persistence/PrismaUserRepository';
import { BcryptPasswordHasher } from './modules/identity/adapters/security/BcryptPasswordHasher';
import { JwtTokenService } from './modules/identity/adapters/security/JwtTokenService';
import { AuthService } from './modules/identity/application/AuthService';
import type { UserRepository } from './modules/identity/ports/out/UserRepository';
import { createOrdersRouter } from './modules/ordering/adapters/http/orders.routes';
import { CartServiceSource } from './modules/ordering/adapters/cart/CartServiceSource';
import { CatalogOrderLookup } from './modules/ordering/adapters/catalog/CatalogOrderLookup';
import { InMemoryOrderPlacement } from './modules/ordering/adapters/persistence/InMemoryOrderPlacement';
import { InMemoryOrderRepository } from './modules/ordering/adapters/persistence/InMemoryOrderRepository';
import { PrismaOrderPlacement } from './modules/ordering/adapters/persistence/PrismaOrderPlacement';
import { InMemoryStockRestoration } from './modules/ordering/adapters/persistence/InMemoryStockRestoration';
import { PrismaOrderRepository } from './modules/ordering/adapters/persistence/PrismaOrderRepository';
import { PrismaStockRestoration } from './modules/ordering/adapters/persistence/PrismaStockRestoration';
import { OrderEventLogger } from './modules/ordering/application/OrderEventLogger';
import { OrderService } from './modules/ordering/application/OrderService';
import { RestockOnOrderCancelled } from './modules/ordering/application/RestockOnOrderCancelled';
import { chainOf } from './modules/ordering/application/validation/CheckoutValidator';
import {
  AddressValidator,
  AmountLimitValidator,
  FraudCheckValidator,
  StockValidator,
  type FraudRules,
} from './modules/ordering/application/validation/validators';
import { MAX_AMOUNT_CENTS } from './modules/ordering/domain/OrderItem';
import {
  NO_PRICE_MODIFIERS,
  type PricingPolicy,
} from './modules/ordering/domain/pricing/PricingPolicy';
import type { OrderPlacement } from './modules/ordering/ports/out/OrderPlacement';
import { createPaymentsRouter } from './modules/payments/adapters/http/payments.routes';
import { OrderSettlementPayableOrders } from './modules/payments/adapters/ordering/OrderSettlementPayableOrders';
import { InMemoryPaymentRepository } from './modules/payments/adapters/persistence/InMemoryPaymentRepository';
import { PrismaPaymentRepository } from './modules/payments/adapters/persistence/PrismaPaymentRepository';
import { CashOnDeliveryFactory } from './modules/payments/adapters/providers/cod/CashOnDeliveryFactory';
import { CourierCodApi } from './modules/payments/adapters/providers/cod/CourierCodApi';
import { PayPalFactory } from './modules/payments/adapters/providers/paypal/PayPalFactory';
import { PayPalMockClient } from './modules/payments/adapters/providers/paypal/PayPalMockClient';
import { StripeFactory } from './modules/payments/adapters/providers/stripe/StripeFactory';
import { StripeMockApi } from './modules/payments/adapters/providers/stripe/StripeMockApi';
import { GetOrderPayment } from './modules/payments/application/GetOrderPayment';
import { HandlePaymentWebhook } from './modules/payments/application/HandlePaymentWebhook';
import { PayOrder } from './modules/payments/application/PayOrder';
import { PaymentProviders } from './modules/payments/application/PaymentProviders';
import { RefundOnOrderCancelled } from './modules/payments/application/RefundOnOrderCancelled';
import { RefundPayment } from './modules/payments/application/RefundPayment';
import type { PaymentProviderFactory } from './modules/payments/ports/out/PaymentProviderFactory';
import { createNotificationsRouter } from './modules/notifications/adapters/http/notifications.routes';
import { createChannelFactories } from './modules/notifications/adapters/channels/channelFactories';
import { InMemoryNotificationOutbox } from './modules/notifications/adapters/persistence/InMemoryNotificationOutbox';
import { InMemoryNotificationPreferenceRepository } from './modules/notifications/adapters/persistence/InMemoryNotificationPreferenceRepository';
import { PrismaNotificationOutbox } from './modules/notifications/adapters/persistence/PrismaNotificationOutbox';
import { PrismaNotificationPreferenceRepository } from './modules/notifications/adapters/persistence/PrismaNotificationPreferenceRepository';
import { NotificationChannels } from './modules/notifications/application/NotificationChannels';
import { NotificationHistoryService } from './modules/notifications/application/NotificationHistoryService';
import { NotificationPreferencesService } from './modules/notifications/application/NotificationPreferencesService';
import { NotificationService } from './modules/notifications/application/NotificationService';
import { OrderStatusNotifier } from './modules/notifications/application/OrderStatusNotifier';
import type { NotificationChannelFactory } from './modules/notifications/domain/NotificationChannelFactory';
import type { NotificationOutbox } from './modules/notifications/ports/out/NotificationOutbox';
import type { NotificationPreferenceRepository } from './modules/notifications/ports/out/NotificationPreferenceRepository';
import { ShippingCostQuotesPricing } from './modules/ordering/adapters/shipping/ShippingCostQuotesPricing';
import { CartUseCasesQuotableCart } from './modules/shipping/adapters/cart/CartUseCasesQuotableCart';
import { FastCourierAdapter } from './modules/shipping/adapters/couriers/fast/FastCourierAdapter';
import { FastCourierMock } from './modules/shipping/adapters/couriers/fast/FastCourierMock';
import { PostOfficeAdapter } from './modules/shipping/adapters/couriers/post/PostOfficeAdapter';
import { PostOfficeMock } from './modules/shipping/adapters/couriers/post/PostOfficeMock';
import { StorePickupCourier } from './modules/shipping/adapters/couriers/StorePickupCourier';
import { createShippingRouter } from './modules/shipping/adapters/http/shipping.routes';
import { OrderFulfillmentShippableOrders } from './modules/shipping/adapters/ordering/OrderFulfillmentShippableOrders';
import { InMemoryShipmentRepository } from './modules/shipping/adapters/persistence/InMemoryShipmentRepository';
import { PrismaShipmentRepository } from './modules/shipping/adapters/persistence/PrismaShipmentRepository';
import { CourierDirectory } from './modules/shipping/application/CourierDirectory';
import { GetOrderShipment } from './modules/shipping/application/GetOrderShipment';
import { QuoteCartShipping } from './modules/shipping/application/QuoteCartShipping';
import { ShipOrder } from './modules/shipping/application/ShipOrder';
import { ShippingCostService } from './modules/shipping/application/ShippingCostService';
import {
  NO_SHIPPING_RATES,
  STANDARD_SHIPPING_RATES,
  ShippingCostStrategies,
  type ShippingRates,
} from './modules/shipping/domain/ShippingCostStrategy';
import type { CourierCode } from './modules/shipping/domain/ShippingTypes';
import type { CourierService } from './modules/shipping/ports/out/CourierService';
import type { ShipmentRepository } from './modules/shipping/ports/out/ShipmentRepository';
import type { PaymentRepository } from './modules/payments/ports/out/PaymentRepository';
import type { OrderRepository } from './modules/ordering/ports/out/OrderRepository';
import type { StockRestoration } from './modules/ordering/ports/out/StockRestoration';
import {
  ConsoleLogger,
  InMemoryEventBus,
  RandomUuidGenerator,
  systemClock,
  type Clock,
  type EventBus,
  type IdGenerator,
  type Logger,
} from './shared';

export interface Container {
  config: Config;
  logger: Logger;
  app: Express;
  shutdown: () => Promise<void>;
}

/** Porturile de persistenta ale aplicatiei; fiecare se poate asambla din adaptoare diferite. */
export interface Repositories {
  products: ProductRepository;
  categories: CategoryRepository;
  bundles: BundleRepository;
  users: UserRepository;
  carts: CartRepository;
  orders: OrderRepository;
  /** Plasarea atomica a comenzilor (stoc + comanda + cos); depinde de adaptoarele de mai sus. */
  orderPlacement: OrderPlacement;
  /** Repunerea idempotenta a stocului unei comenzi anulate. */
  stockRestoration: StockRestoration;
  payments: PaymentRepository;
  shipments: ShipmentRepository;
  /** Outbox-ul canalelor simulate, care e si istoricul notificarilor clientului. */
  notificationOutbox: NotificationOutbox;
  notificationPreferences: NotificationPreferenceRepository;
}

/** Adaptoare in-memory: pornesc fara baza de date (teste, demo rapid). */
export function createInMemoryRepositories(): Repositories {
  const products = new InMemoryProductRepository();
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  return {
    products,
    categories: new InMemoryCategoryRepository(),
    bundles: new InMemoryBundleRepository(products),
    users: new InMemoryUserRepository(),
    carts,
    orders,
    orderPlacement: new InMemoryOrderPlacement(orders, products, carts),
    stockRestoration: new InMemoryStockRestoration(products),
    payments: new InMemoryPaymentRepository(),
    shipments: new InMemoryShipmentRepository(),
    notificationOutbox: new InMemoryNotificationOutbox(),
    notificationPreferences: new InMemoryNotificationPreferenceRepository(),
  };
}

/** Adaptoare Prisma/PostgreSQL; citirile de produse trec printr-un proxy cu cache. */
export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  const products = new CachingProductRepository(new PrismaProductRepository(prisma));
  return {
    products,
    categories: new PrismaCategoryRepository(prisma),
    bundles: new PrismaBundleRepository(prisma),
    users: new PrismaUserRepository(prisma),
    carts: new PrismaCartRepository(prisma),
    orders: new PrismaOrderRepository(prisma),
    // Plasarea unei comenzi scade stocul direct in baza de date, pe langa proxy: invalidam cache-ul.
    orderPlacement: new PrismaOrderPlacement(prisma, (ids) => products.evict(ids)),
    stockRestoration: new PrismaStockRestoration(prisma, (ids) => products.evict(ids)),
    payments: new PrismaPaymentRepository(prisma),
    shipments: new PrismaShipmentRepository(prisma),
    notificationOutbox: new PrismaNotificationOutbox(prisma),
    notificationPreferences: new PrismaNotificationPreferenceRepository(prisma),
  };
}

export interface SecuritySettings {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  bcryptRounds: number;
  /** Limita de cereri per IP pentru /auth/register si /auth/login. */
  authRateLimit: { windowMs: number; max: number };
}

/** Regulile de business ale comenzilor, venite din configurare (pret, lantul de validare). */
export interface OrderingSettings {
  pricing: PricingPolicy;
  /** Tarile in care se livreaza (coduri ISO de 2 litere). */
  allowedCountries: readonly string[];
  /** Totalul maxim al unei comenzi, in cenți. */
  maxOrderAmountCents: number;
  fraud: FraudRules;
}

/** Fara reduceri sau TVA si cu praguri largi: pentru teste si demo in-memory (productia primeste valorile din `config`). */
export const DEFAULT_ORDERING_SETTINGS: OrderingSettings = {
  pricing: NO_PRICE_MODIFIERS,
  allowedCountries: ['RO', 'MD'],
  maxOrderAmountCents: MAX_AMOUNT_CENTS,
  fraud: { maxOrdersPerWindow: 1000, windowMs: 60_000, suspiciousAmountCents: MAX_AMOUNT_CENTS },
};

/** Configurarea platilor: secretul webhook-urilor si, optional, furnizorii (implicit: cele trei mock-uri locale). */
export interface PaymentSettings {
  webhookSecret: string;
  /** Fabricile furnizorilor; testele pot injecta mock-uri proprii ca sa observe apelurile sau sa simuleze erori. */
  factories?: readonly PaymentProviderFactory[];
}

/** Familiile de furnizori implicite: toate sunt mock-uri locale, fara apeluri de retea. */
export function createMockPaymentFactories(
  webhookSecret: string,
  clock: Clock = systemClock,
): PaymentProviderFactory[] {
  return [
    new StripeFactory(new StripeMockApi(), webhookSecret, clock),
    new PayPalFactory(new PayPalMockClient(), webhookSecret, clock),
    new CashOnDeliveryFactory(new CourierCodApi(), webhookSecret),
  ];
}

/**
 * Configurarea livrarii: tarifele strategiilor de cost si, optional, serviciile curierilor (implicit: mock-urile locale).
 * Fara tarife (implicit in teste si demo in-memory) livrarea e gratuita si totalul comenzii nu o include; productia
 * primeste `STANDARD_SHIPPING_RATES`.
 */
export interface ShippingSettings {
  rates: ShippingRates;
  /** Serviciile curierilor; testele pot injecta unele proprii ca sa observe apelurile sau sa simuleze erori. */
  couriers?: Readonly<Record<CourierCode, CourierService>>;
}

/** Curierii impliciti: doua mock-uri cu API-uri diferite (aduse la `CourierService` prin adaptoare) si ridicarea din magazin. */
export function createMockCouriers(
  clock: Clock = systemClock,
): Record<CourierCode, CourierService> {
  return {
    FAST_COURIER: new FastCourierAdapter(new FastCourierMock({ clock })),
    POST_OFFICE: new PostOfficeAdapter(new PostOfficeMock({ clock })),
    STORE_PICKUP: new StorePickupCourier(),
  };
}

/** Configurarea notificarilor: optional, fabricile de canale (implicit: email, SMS si push simulate, scriind in outbox). */
export interface NotificationSettings {
  /** Testele pot injecta fabrici proprii ca sa observe trimiterile sau sa simuleze erori. */
  factories?: readonly NotificationChannelFactory[];
}

export interface ApplicationDependencies {
  logger: Logger;
  repositories: Repositories;
  security: SecuritySettings;
  checkDatabase: () => Promise<void>;
  /** Generatorul de id-uri (implicit UUID aleatoriu; testele pot injecta unul determinist). */
  ids?: IdGenerator;
  ordering?: OrderingSettings;
  payments: PaymentSettings;
  shipping?: ShippingSettings;
  notifications?: NotificationSettings;
  /** Ceasul aplicatiei (plati: momentele tranzitiilor si toleranta webhook-urilor); testele pot injecta unul controlat. */
  clock?: Clock;
  /** Magistrala de evenimente (implicit in-memory); testele pot injecta una proprie ca sa observe evenimentele. */
  events?: EventBus;
}

/**
 * Asambleaza aplicatia HTTP din porturile de persistenta primite: aceeasi cablare ruleaza
 * in productie (Prisma) si in teste (in-memory), deci testele exercita codul real.
 */
export function createApplication({
  logger,
  repositories,
  security,
  checkDatabase,
  ids = new RandomUuidGenerator(),
  ordering = DEFAULT_ORDERING_SETTINGS,
  payments: paymentSettings,
  shipping: shippingSettings = { rates: NO_SHIPPING_RATES },
  notifications: notificationSettings = {},
  clock = systemClock,
  events = new InMemoryEventBus(logger.child({ module: 'events' })),
}: ApplicationDependencies): Express {
  // Identity
  const tokens = new JwtTokenService(security.jwtSecret, security.jwtExpiresInSeconds);
  const hasher = new BcryptPasswordHasher(security.bcryptRounds);
  const auth = new AuthService(
    repositories.users,
    hasher,
    tokens,
    ids,
    logger.child({ module: 'identity' }),
  );
  const authentication = createAuthentication(tokens);

  // Catalog
  const catalogQueries = new CatalogQueryService(
    repositories.products,
    repositories.categories,
    repositories.bundles,
  );
  const catalogAdmin = new CatalogAdminUseCases(
    repositories.products,
    repositories.categories,
    repositories.bundles,
    ids,
    logger.child({ module: 'catalog' }),
  );

  // Cart
  const cart = new CartService(repositories.carts, new CatalogItemLookup(catalogQueries), ids);

  // Ordering
  const orderCatalog = new CatalogOrderLookup(catalogQueries);
  const orderLogger = logger.child({ module: 'ordering' });

  // Lantul de validare a checkout-ului (Chain of Responsibility): o veriga noua se adauga aici,
  // in ordinea dorita, fara sa se modifice OrderService.
  const checkoutValidation = chainOf(
    new StockValidator(),
    new AddressValidator(ordering.allowedCountries),
    new AmountLimitValidator(ordering.maxOrderAmountCents),
    new FraudCheckValidator(repositories.orders, ordering.fraud),
  );

  // Abonatii evenimentelor comenzii (Observer): jurnal fara date personale + repunerea stocului la anulare.
  new OrderEventLogger(orderLogger).register(events);
  new RestockOnOrderCancelled(orderCatalog, repositories.stockRestoration, orderLogger).register(
    events,
  );

  // Notifications: canalele se creeaza prin fabrici (Factory Method), notificarile sunt abstractii separate de canale (Bridge),
  // iar abonatul (Observer) le declanseaza la evenimentele comenzii. Se inregistreaza INAINTEA rambursarii (modulul `payments`),
  // ca "comanda anulata" sa apara in istoric inaintea "banii au fost returnati" (rambursarea publica OrderRefunded din handlerul ei).
  const notificationLogger = logger.child({ module: 'notifications' });
  const notificationPreferences = new NotificationPreferencesService(
    repositories.notificationPreferences,
  );
  new OrderStatusNotifier(
    new NotificationService(
      new NotificationChannels(
        notificationSettings.factories ??
          createChannelFactories({
            outbox: repositories.notificationOutbox,
            ids,
            clock,
            logger: notificationLogger,
          }),
      ),
      notificationPreferences,
      notificationLogger,
    ),
    notificationLogger,
  ).register(events);

  // Shipping: costul livrarii se alege dupa metoda comenzii (Strategy) si intra in totalul comenzii prin `ShippingDecorator`.
  const shippingLogger = logger.child({ module: 'shipping' });
  const shippingCosts = new ShippingCostService(
    ShippingCostStrategies.fromRates(shippingSettings.rates),
  );
  const pricing = {
    ...ordering.pricing,
    shipping: ordering.pricing.shipping ?? new ShippingCostQuotesPricing(shippingCosts),
  };

  const orders = new OrderService(
    repositories.orders,
    new CartServiceSource(cart),
    orderCatalog,
    repositories.orderPlacement,
    checkoutValidation,
    pricing,
    events,
    ids,
    orderLogger,
  );

  // Payments: furnizorii se aleg dupa metoda de plata (Abstract Factory), iar `ordering` e vazut doar prin portul de decontare.
  const paymentLogger = logger.child({ module: 'payments' });
  const payableOrders = new OrderSettlementPayableOrders(orders);
  const providers = new PaymentProviders(
    paymentSettings.factories ?? createMockPaymentFactories(paymentSettings.webhookSecret, clock),
    { payments: repositories.payments, clock, logger: paymentLogger },
  );
  const refundPayment = new RefundPayment(repositories.payments, providers, clock, paymentLogger);
  // Abonat (Observer): o comanda platita si apoi anulata se ramburseaza si trece in REFUNDED.
  new RefundOnOrderCancelled(
    payableOrders,
    repositories.payments,
    refundPayment,
    paymentLogger,
  ).register(events);

  // Curierii se aleg dupa metoda de livrare; `ordering` e vazut doar prin portul de expediere.
  const couriers = new CourierDirectory(shippingSettings.couriers ?? createMockCouriers(clock), {
    STANDARD: 'POST_OFFICE',
    EXPRESS: 'FAST_COURIER',
    STORE_PICKUP: 'STORE_PICKUP',
  });
  const shippableOrders = new OrderFulfillmentShippableOrders(orders);

  return createApp({
    logger,
    checkDatabase,
    middlewares: [authentication.authenticate],
    routers: [
      createAuthRouter({
        auth,
        requireAuth: authentication.requireAuth,
        rateLimit: security.authRateLimit,
      }),
      createCatalogRouter({
        queries: catalogQueries,
        admin: {
          // Doua straturi de aparare: middleware-ul HTTP (rol ADMIN) si AuthorizationProxy (Proxy S4).
          guards: [authentication.requireRole('ADMIN')],
          serviceFor: (req) =>
            new AuthorizationProxy(
              catalogAdmin,
              req.principal ?? null,
              logger.child({ module: 'catalog' }),
            ),
        },
      }),
      createCartRouter({ cart, requireAuth: authentication.requireAuth }),
      createOrdersRouter({
        orders,
        requireAuth: authentication.requireAuth,
        requireAdmin: authentication.requireRole('ADMIN'),
      }),
      createPaymentsRouter({
        payOrder: new PayOrder(
          payableOrders,
          repositories.payments,
          providers,
          refundPayment,
          ids,
          clock,
          paymentLogger,
        ),
        getOrderPayment: new GetOrderPayment(payableOrders, repositories.payments),
        webhooks: new HandlePaymentWebhook(providers, repositories.payments, paymentLogger),
        requireAuth: authentication.requireAuth,
      }),
      createNotificationsRouter({
        history: new NotificationHistoryService(repositories.notificationOutbox),
        preferences: notificationPreferences,
        requireAuth: authentication.requireAuth,
      }),
      createShippingRouter({
        shipOrder: new ShipOrder(
          shippableOrders,
          repositories.shipments,
          couriers,
          ids,
          clock,
          shippingLogger,
        ),
        getOrderShipment: new GetOrderShipment(
          shippableOrders,
          repositories.shipments,
          couriers,
          clock,
          shippingLogger,
        ),
        quoteShipping: new QuoteCartShipping(
          new CartUseCasesQuotableCart(cart),
          shippingCosts,
          couriers,
        ),
        requireAuth: authentication.requireAuth,
        requireAdmin: authentication.requireRole('ADMIN'),
      }),
    ],
  });
}

/**
 * Composition root: singurul loc unde se aleg implementarile concrete si se asambleaza
 * dependentele (DI manual). Modulele noi isi inregistreaza aici adaptoarele.
 */
export function createContainer(config: Config): Container {
  const logger = new ConsoleLogger(config.LOG_LEVEL);
  const prisma = createPrismaClient(config.DATABASE_URL);

  const app = createApplication({
    logger,
    repositories: createPrismaRepositories(prisma),
    security: {
      jwtSecret: config.JWT_SECRET,
      jwtExpiresInSeconds: config.JWT_EXPIRES_IN_SECONDS,
      bcryptRounds: config.BCRYPT_ROUNDS,
      authRateLimit: {
        windowMs: config.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
        max: config.AUTH_RATE_LIMIT_MAX,
      },
    },
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    payments: { webhookSecret: config.PAYMENT_WEBHOOK_SECRET },
    shipping: { rates: STANDARD_SHIPPING_RATES },
    ordering: {
      pricing: { vatPercent: config.VAT_PERCENT, discountTiers: config.DISCOUNT_TIERS },
      allowedCountries: config.SHIPPING_COUNTRIES,
      maxOrderAmountCents: config.MAX_ORDER_AMOUNT_CENTS,
      fraud: {
        maxOrdersPerWindow: config.FRAUD_MAX_ORDERS_PER_WINDOW,
        windowMs: config.FRAUD_WINDOW_SECONDS * 1000,
        suspiciousAmountCents: config.FRAUD_SUSPICIOUS_AMOUNT_CENTS,
      },
    },
  });

  return {
    config,
    logger,
    app,
    shutdown: async () => {
      await prisma.$disconnect();
    },
  };
}
