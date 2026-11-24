import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Clock,
  type IdGenerator,
  type Logger,
  type Principal,
} from '../../../shared';
import { CourierRejectedError, CourierTimeoutError } from '../domain/errors';
import { Shipment } from '../domain/Shipment';
import type { ShipOrderUseCase } from '../ports/in/ShippingUseCases';
import type { CourierShipment } from '../ports/out/CourierService';
import type { ShippableOrder, ShippableOrders } from '../ports/out/ShippableOrders';
import type { ShipmentRepository } from '../ports/out/ShipmentRepository';
import type { CourierDirectory } from './CourierDirectory';

/** Cod scurt, stabil, pastrat pe livrarea esuata (fara mesaje brute ale curierului). */
function failureReasonOf(error: unknown): string {
  if (error instanceof CourierRejectedError) return error.reason;
  if (error instanceof CourierTimeoutError) return 'courier_timeout';
  return 'courier_error';
}

/**
 * Dupa cat timp o livrare ramasa PENDING e considerata abandonata (procesul care o revendicase a cazut) si poate fi
 * reluata. Curierul primeste aceeasi cheie de idempotenta, deci un colet deja creat de prima incercare e regasit, nu dublat.
 */
export const STALE_PENDING_MS = 2 * 60_000;

const inProgress = (): ConflictError =>
  new ConflictError('Comanda este deja in curs de expediere', 'SHIPMENT_IN_PROGRESS');

/**
 * Expedierea unei comenzi platite (doar ADMIN): revendica livrarea (unica pe comanda), o preda curierului metodei de
 * livrare, apoi trece comanda in SHIPPED (State) si emite `OrderShipped`.
 *
 * Fara dubla expediere, nici la cereri simultane: livrarea se _revendica_ inserand-o (`order_id` unic); doar cererea care
 * a inserat-o ajunge la curier, celelalte primesc 409. Daca decontarea comenzii (`SHIPPED`) esueaza dupa ce curierul a
 * preluat coletul, livrarea ramane `CREATED` si o noua cerere duce la capat doar trecerea comenzii in `SHIPPED`, fara un al doilea colet.
 */
export class ShipOrder implements ShipOrderUseCase {
  constructor(
    private readonly orders: ShippableOrders,
    private readonly shipments: ShipmentRepository,
    private readonly couriers: CourierDirectory,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(principal: Principal, orderId: string): Promise<Shipment> {
    if (principal.role !== 'ADMIN') throw new ForbiddenError();

    const order = await this.orders.find(orderId);
    if (!order) throw new NotFoundError('Comanda', orderId);
    if (order.state === 'SHIPPED') {
      throw new ConflictError('Comanda a fost deja expediata', 'ORDER_ALREADY_SHIPPED');
    }
    if (order.state !== 'AWAITING_SHIPMENT') {
      throw new ConflictError('Doar o comanda platita poate fi expediata', 'ORDER_NOT_SHIPPABLE');
    }

    let shipment = await this.claim(order);
    // PENDING = abia revendicata de noi, curierul nu a primit-o inca; altfel curierul o are deja (reluare dupa o decontare esuata).
    if (shipment.status === 'PENDING') shipment = await this.handToCourier(order, shipment);

    try {
      await this.orders.markShipped(order.id);
    } catch (error) {
      // Cerere pierzatoare intr-o cursa: alta cerere a trecut deja comanda in SHIPPED intre citire si acum.
      if ((await this.orders.find(order.id))?.state === 'SHIPPED') {
        throw new ConflictError('Comanda a fost deja expediata', 'ORDER_ALREADY_SHIPPED');
      }
      this.logger.error('Curierul a preluat coletul, dar comanda nu a putut fi marcata SHIPPED', {
        orderId: order.id,
        shipmentId: shipment.id,
        error,
      });
      throw error;
    }
    this.logger.info('Comanda expediata', {
      orderId: order.id,
      shipmentId: shipment.id,
      courier: shipment.courier,
      trackingNumber: shipment.trackingNumber,
    });
    return shipment;
  }

  /** Revendica livrarea comenzii: una noua (PENDING), una esuata reluata, sau cea deja preluata de curier. */
  private async claim(order: ShippableOrder): Promise<Shipment> {
    const now = this.clock();
    const existing = await this.shipments.findByOrderId(order.id);

    if (!existing) {
      const started = Shipment.start({
        id: this.ids.next(),
        orderId: order.id,
        courier: this.couriers.courierFor(order.deliveryMethod),
        cost: order.shippingCost,
        now,
      });
      try {
        await this.shipments.insert(started);
      } catch (error) {
        // A inserat-o altcineva intre timp: el expediaza, noi nu.
        if (error instanceof ConflictError) throw inProgress();
        throw error;
      }
      return started;
    }

    if (
      existing.status === 'PENDING' &&
      now.getTime() - existing.updatedAt.getTime() < STALE_PENDING_MS
    ) {
      throw inProgress();
    }
    if (existing.status !== 'FAILED' && existing.status !== 'PENDING') return existing;

    // FAILED (esec al curierului) sau PENDING abandonat: reluare atomica (UPDATE ... WHERE status = ...).
    const retried = existing.status === 'FAILED' ? existing.retry(now) : existing.restart(now);
    try {
      await this.shipments.update(retried, existing.status);
    } catch (error) {
      if (error instanceof ConflictError) throw inProgress();
      throw error;
    }
    return retried;
  }

  /** Preda coletul curierului si salveaza rezultatul; un esec al curierului se salveaza FAILED (si se poate relua). */
  private async handToCourier(order: ShippableOrder, shipment: Shipment): Promise<Shipment> {
    let created: CourierShipment;
    try {
      created = await this.couriers.serviceOf(shipment.courier).createShipment({
        reference: order.id,
        recipient: order.recipient,
        units: order.units,
        declaredValue: order.total,
        idempotencyKey: `ship:${order.id}`,
      });
    } catch (error) {
      await this.recordFailure(shipment, error);
      throw error;
    }

    const saved = shipment.created(created.externalId, created.trackingNumber, this.clock());
    try {
      await this.shipments.update(saved, 'PENDING');
    } catch (error) {
      // Curierul are coletul, dar noi nu am putut salva rezultatul: id-urile se logheaza pentru reconciliere manuala.
      this.logger.error('Coletul exista la curier, dar livrarea nu a putut fi salvata', {
        orderId: order.id,
        shipmentId: shipment.id,
        courier: shipment.courier,
        externalId: created.externalId,
        trackingNumber: created.trackingNumber,
        error,
      });
      throw error;
    }
    return saved;
  }

  private async recordFailure(shipment: Shipment, cause: unknown): Promise<void> {
    try {
      await this.shipments.update(shipment.failed(failureReasonOf(cause), this.clock()), 'PENDING');
    } catch (error) {
      this.logger.error('Eroarea curierului nu a putut fi salvata pe livrare', {
        shipmentId: shipment.id,
        error,
      });
    }
  }
}
