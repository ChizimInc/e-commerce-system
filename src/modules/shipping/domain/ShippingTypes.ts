/**
 * Metodele de livrare ale unei comenzi. Sunt aceleasi valori ca in modulul `ordering`, dar declarate aici:
 * `shipping` nu importa interioarele altui modul (adaptoarele fac legatura, iar compilatorul refuza
 * asignarea daca listele ar diverge).
 */
export const DELIVERY_METHODS = ['STANDARD', 'EXPRESS', 'STORE_PICKUP'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Cine duce coletul: doi curieri (mock-uri) si ridicarea din magazin (fara curier extern). */
export const COURIERS = ['FAST_COURIER', 'POST_OFFICE', 'STORE_PICKUP'] as const;
export type CourierCode = (typeof COURIERS)[number];

/**
 * Starile unei livrari:
 *  - `PENDING`: revendicata de o expediere, curierul inca nu a raspuns (unicitatea pe comanda o protejeaza de dubla expediere);
 *  - `CREATED`: curierul a preluat coletul (are id si numar de urmarire);
 *  - `IN_TRANSIT` / `DELIVERED` / `RETURNED`: starea raportata de curier la urmarire;
 *  - `FAILED`: curierul a refuzat sau a esuat (se poate relua).
 */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'CREATED',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'FAILED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Ce poate raporta un curier la urmarire (subsetul starilor unui colet deja preluat). */
export const TRACKING_STATUSES = ['CREATED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED'] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
