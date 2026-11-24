/** Un eveniment de domeniu: ceva s-a intamplat deja (nume la trecut), identificat prin `type`. */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

export type EventHandler<E extends DomainEvent> = (event: E) => void | Promise<void>;

/** Anuleaza abonarea la care a fost returnata. */
export type Unsubscribe = () => void;

/**
 * Port: magistrala de evenimente de domeniu (Observer). Modulele publica evenimente fara sa stie cine le
 * asculta, iar abonatii (log, repunere stoc, notificari) se aleg in composition root.
 *
 * Contract: `publish` nu respinge niciodata promisiunea si nu arunca; o eroare dintr-un abonat nu
 * opreste ceilalti abonati si nu ajunge la cel care a publicat (evenimentul s-a intamplat deja).
 */
export interface EventBus {
  /** Livreaza evenimentul abonatilor tipului sau, in ordinea abonarii, si asteapta sa termine. */
  publish(event: DomainEvent): Promise<void>;
  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe;
}
