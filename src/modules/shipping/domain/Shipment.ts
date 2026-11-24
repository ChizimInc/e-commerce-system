import { DomainError, type Money } from '../../../shared';
import type { CourierCode, ShipmentStatus, TrackingStatus } from './ShippingTypes';

export interface ShipmentProps {
  readonly id: string;
  readonly orderId: string;
  readonly courier: CourierCode;
  readonly status: ShipmentStatus;
  /** Costul livrarii (cenți + moneda), copiat din comanda: ce a platit clientul pentru livrare. */
  readonly cost: Money;
  /** Id-ul coletului la curier; `null` pana cand curierul il preia. */
  readonly externalId: string | null;
  /** Numarul de urmarire afisat clientului; `null` pana cand curierul il preia. */
  readonly trackingNumber: string | null;
  /** Cod scurt, stabil, pentru FAILED (ex. `address_not_serviceable`); fara mesaje brute ale curierului. */
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StartShipmentProps {
  readonly id: string;
  readonly orderId: string;
  readonly courier: CourierCode;
  readonly cost: Money;
  readonly now: Date;
}

/** Starile in care curierul are deja coletul: id-ul lui si numarul de urmarire sunt obligatorii. */
const NEEDS_COURIER_IDS: readonly ShipmentStatus[] = [
  'CREATED',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
];

/** Ordinea in care un colet avanseaza la urmarire; o stare mai veche raportata tarziu nu o da inapoi. */
const TRACKING_RANK: Record<TrackingStatus, number> = {
  CREATED: 0,
  IN_TRANSIT: 1,
  DELIVERED: 2,
  RETURNED: 2,
};

function isTrackingStatus(status: ShipmentStatus): status is TrackingStatus {
  return status in TRACKING_RANK;
}

/**
 * Livrarea unei comenzi (agregat). Imutabila, ca `Order` si `Payment`: fiecare tranzitie intoarce o livrare noua,
 * iar una refuzata nu lasa nimic pe jumatate. Ciclul de viata: PENDING -> CREATED -> IN_TRANSIT -> DELIVERED / RETURNED,
 * cu iesire in FAILED (din care se poate relua).
 */
export class Shipment {
  readonly id: string;
  readonly orderId: string;
  readonly courier: CourierCode;
  readonly status: ShipmentStatus;
  readonly cost: Money;
  readonly externalId: string | null;
  readonly trackingNumber: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ShipmentProps) {
    this.id = props.id;
    this.orderId = props.orderId;
    this.courier = props.courier;
    this.status = props.status;
    this.cost = props.cost;
    this.externalId = props.externalId;
    this.trackingNumber = props.trackingNumber;
    this.failureReason = props.failureReason;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** O livrare noua porneste mereu in PENDING (revendicata, curierul inca nu a fost apelat). */
  static start({ id, orderId, courier, cost, now }: StartShipmentProps): Shipment {
    return Shipment.restore({
      id,
      orderId,
      courier,
      status: 'PENDING',
      cost,
      externalId: null,
      trackingNumber: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstruieste o livrare salvata (repository-urile); refuza date incoerente. */
  static restore(props: ShipmentProps): Shipment {
    if (props.cost.isNegative()) {
      throw new DomainError('Costul livrarii nu poate fi negativ', 'INVALID_SHIPMENT');
    }
    if (
      NEEDS_COURIER_IDS.includes(props.status) &&
      (props.externalId === null || props.trackingNumber === null)
    ) {
      throw new DomainError(
        `Livrarea ${props.status} trebuie sa aiba id la curier si numar de urmarire`,
        'INVALID_SHIPMENT',
      );
    }
    return new Shipment(props);
  }

  /** Curierul a preluat coletul. */
  created(externalId: string, trackingNumber: string, now: Date): Shipment {
    return this.moveTo(['PENDING'], 'CREATED', now, { externalId, trackingNumber });
  }

  /** Curierul a refuzat sau a esuat; nu exista colet la curier, deci nu se pastreaza ids. */
  failed(reason: string, now: Date): Shipment {
    return this.moveTo(['PENDING'], 'FAILED', now, { failureReason: reason });
  }

  /** Reia o livrare ramasa PENDING (procesul care o revendicase a cazut): reinnoieste momentul revendicarii. */
  restart(now: Date): Shipment {
    return this.moveTo(['PENDING'], 'PENDING', now, {});
  }

  /** Reia o livrare esuata (administratorul incearca din nou); sterge urmele incercarii anterioare. */
  retry(now: Date): Shipment {
    return this.moveTo(['FAILED'], 'PENDING', now, { failureReason: null });
  }

  /**
   * Aplica starea raportata de curier. Doar inainte: o stare identica sau mai veche (raspuns intarziat) lasa
   * livrarea neschimbata, iar DELIVERED / RETURNED sunt finale.
   */
  tracked(reported: TrackingStatus, now: Date): Shipment {
    if (!isTrackingStatus(this.status)) {
      throw new DomainError(
        `Livrarea ${this.status} nu poate fi urmarita la curier`,
        'INVALID_SHIPMENT_TRANSITION',
      );
    }
    if (TRACKING_RANK[reported] <= TRACKING_RANK[this.status]) return this;
    return Shipment.restore({ ...this, status: reported, updatedAt: now });
  }

  /** Mai poate coletul sa-si schimbe starea la curier (nu e nici livrat, nici returnat)? */
  isTrackable(): boolean {
    return this.status === 'CREATED' || this.status === 'IN_TRANSIT';
  }

  private moveTo(
    from: readonly ShipmentStatus[],
    status: ShipmentStatus,
    now: Date,
    changes: Partial<Pick<ShipmentProps, 'externalId' | 'trackingNumber' | 'failureReason'>>,
  ): Shipment {
    if (!from.includes(this.status)) {
      throw new DomainError(
        `Tranzitie invalida a livrarii: ${this.status} -> ${status}`,
        'INVALID_SHIPMENT_TRANSITION',
      );
    }
    return Shipment.restore({ ...this, ...changes, status, updatedAt: now });
  }
}
