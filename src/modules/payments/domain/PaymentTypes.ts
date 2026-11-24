/**
 * Metodele de plata ale unei comenzi. Sunt aceleasi valori ca in modulul `ordering`, dar declarate aici:
 * `payments` nu importa interioarele altui modul (adaptorul `adapters/ordering` face legatura, iar compilatorul
 * refuza asignarea daca listele ar diverge).
 */
export const PAYMENT_METHODS = ['CARD', 'PAYPAL', 'CASH_ON_DELIVERY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Furnizorii de plata (cate o familie de componente fiecare). `COD` = ramburs, prin curier. */
export const PAYMENT_PROVIDERS = ['STRIPE', 'PAYPAL', 'COD'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Starile unei plati:
 *  - `PENDING`: inregistrata, inca nepreluata de furnizor (cheia de idempotenta o protejeaza de dubla plata);
 *  - `AUTHORIZED`: furnizorul a rezervat suma (stare intermediara, in cursul procesarii);
 *  - `CAPTURED`: suma a fost incasata;
 *  - `REFUNDING` / `REFUNDED`: rambursare revendicata de un singur proces / incheiata;
 *  - `DECLINED`: furnizorul a refuzat plata (card refuzat); `FAILED`: eroare tehnica, timeout sau validare.
 */
export const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'REFUNDING',
  'REFUNDED',
  'DECLINED',
  'FAILED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
