import { DomainError, type Money } from '../../../shared';
import type { PaymentProvider, PaymentStatus } from './PaymentTypes';

export interface PaymentProps {
  readonly id: string;
  readonly orderId: string;
  readonly provider: PaymentProvider;
  /** Suma de plata (in cenți + moneda), copiata din totalul comenzii. */
  readonly amount: Money;
  readonly status: PaymentStatus;
  /** Id-ul tranzactiei la furnizor, cu care se capteaza si se ramburseaza; `null` pana la autorizare. */
  readonly externalId: string | null;
  /** Id-ul rambursarii la furnizor; `null` pana la rambursare. */
  readonly refundExternalId: string | null;
  /** Cod scurt, stabil, pentru DECLINED / FAILED (ex. `card_declined`); fara mesaje brute ale furnizorului. */
  readonly failureReason: string | null;
  /** Unica pe plata si pe comanda: o comanda nu are doua plati, chiar si la cereri concurente. */
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StartPaymentProps {
  readonly id: string;
  readonly orderId: string;
  readonly provider: PaymentProvider;
  readonly amount: Money;
  readonly now: Date;
}

type Changes = Partial<Pick<PaymentProps, 'externalId' | 'refundExternalId' | 'failureReason'>>;

/** Starile in care furnizorul are deja banii (sau ii tine rezervati): id-ul de la furnizor e obligatoriu. */
const NEEDS_EXTERNAL_ID: readonly PaymentStatus[] = [
  'AUTHORIZED',
  'CAPTURED',
  'REFUNDING',
  'REFUNDED',
];

/**
 * Plata unei comenzi (agregat). Imutabila, ca `Order`: fiecare tranzitie intoarce o plata noua, iar una
 * refuzata nu lasa nimic pe jumatate. Ciclul de viata: PENDING -> AUTHORIZED -> CAPTURED -> REFUNDING -> REFUNDED,
 * cu iesiri in DECLINED / FAILED (din care se poate relua).
 */
export class Payment {
  readonly id: string;
  readonly orderId: string;
  readonly provider: PaymentProvider;
  readonly amount: Money;
  readonly status: PaymentStatus;
  readonly externalId: string | null;
  readonly refundExternalId: string | null;
  readonly failureReason: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: PaymentProps) {
    this.id = props.id;
    this.orderId = props.orderId;
    this.provider = props.provider;
    this.amount = props.amount;
    this.status = props.status;
    this.externalId = props.externalId;
    this.refundExternalId = props.refundExternalId;
    this.failureReason = props.failureReason;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Cheia de idempotenta a platii unei comenzi: aceeasi comanda da mereu aceeasi cheie. */
  static idempotencyKeyFor(orderId: string): string {
    return `pay:${orderId}`;
  }

  /** O plata noua porneste mereu in PENDING. */
  static start({ id, orderId, provider, amount, now }: StartPaymentProps): Payment {
    return Payment.restore({
      id,
      orderId,
      provider,
      amount,
      status: 'PENDING',
      externalId: null,
      refundExternalId: null,
      failureReason: null,
      idempotencyKey: Payment.idempotencyKeyFor(orderId),
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstruieste o plata salvata (repository-urile); refuza date incoerente. */
  static restore(props: PaymentProps): Payment {
    if (props.amount.amount <= 0) {
      throw new DomainError('Suma platii trebuie sa fie pozitiva', 'INVALID_PAYMENT');
    }
    if (NEEDS_EXTERNAL_ID.includes(props.status) && props.externalId === null) {
      throw new DomainError(
        `Plata ${props.status} trebuie sa aiba id la furnizor`,
        'INVALID_PAYMENT',
      );
    }
    if (props.status === 'REFUNDED' && props.refundExternalId === null) {
      throw new DomainError(
        'Plata rambursata trebuie sa aiba id-ul rambursarii',
        'INVALID_PAYMENT',
      );
    }
    return new Payment(props);
  }

  authorized(externalId: string, now: Date): Payment {
    return this.moveTo(['PENDING'], 'AUTHORIZED', now, { externalId });
  }

  /** Captarea poate schimba id-ul de referinta (ex. PayPal: id-ul capturii difera de al autorizarii). */
  captured(externalId: string, now: Date): Payment {
    return this.moveTo(['AUTHORIZED'], 'CAPTURED', now, { externalId });
  }

  declined(reason: string, now: Date): Payment {
    return this.moveTo(['PENDING'], 'DECLINED', now, { failureReason: reason });
  }

  /** Pastreaza id-ul autorizarii (daca exista): o rezervare ramasa pe jumatate trebuie sa poata fi gasita la furnizor. */
  failed(reason: string, now: Date): Payment {
    return this.moveTo(['PENDING', 'AUTHORIZED'], 'FAILED', now, { failureReason: reason });
  }

  /** Reia o plata esuata sau refuzata (clientul incearca din nou); sterge urmele incercarii anterioare. */
  retry(now: Date): Payment {
    return this.moveTo(['DECLINED', 'FAILED'], 'PENDING', now, {
      externalId: null,
      failureReason: null,
    });
  }

  /** Revendica rambursarea: doar un proces o poate porni (se salveaza cu concurenta optimista). */
  startRefund(now: Date): Payment {
    return this.moveTo(['CAPTURED'], 'REFUNDING', now, {});
  }

  refunded(refundExternalId: string, now: Date): Payment {
    return this.moveTo(['REFUNDING'], 'REFUNDED', now, { refundExternalId });
  }

  /** Rambursarea a esuat la furnizor: plata ramane incasata si se poate reincerca. */
  rollbackRefund(now: Date): Payment {
    return this.moveTo(['REFUNDING'], 'CAPTURED', now, {});
  }

  /** Fiecare actiune isi declara starile-sursa (doua actiuni pot duce in aceeasi stare din surse diferite). */
  private moveTo(
    from: readonly PaymentStatus[],
    status: PaymentStatus,
    now: Date,
    changes: Changes,
  ): Payment {
    if (!from.includes(this.status)) {
      throw new DomainError(
        `Tranzitie invalida a platii: ${this.status} -> ${status}`,
        'INVALID_PAYMENT_TRANSITION',
      );
    }
    return Payment.restore({ ...this, ...changes, status, updatedAt: now });
  }
}
