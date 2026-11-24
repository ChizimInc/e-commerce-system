/** Starile ciclului de viata al unei comenzi (vezi `state/` pentru tranzitiile permise). */
export const ORDER_STATUSES = [
  'NEW',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Metodele de livrare si de plata sunt, deocamdata, simple valori; logica lor vine in modulele `shipping` / `payments`. */
export const DELIVERY_METHODS = ['STANDARD', 'EXPRESS', 'STORE_PICKUP'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const PAYMENT_METHODS = ['CARD', 'PAYPAL', 'CASH_ON_DELIVERY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
