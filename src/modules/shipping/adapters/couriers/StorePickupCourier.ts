import { newRunId } from './mock-support';
import { CourierProviderError } from '../../domain/errors';
import type {
  CourierService,
  CourierShipment,
  CourierTracking,
  CreateCourierShipmentRequest,
} from '../../ports/out/CourierService';

/**
 * Ridicarea din magazin: nu exista curier extern, deci nu exista apel de retea. "Expedierea" pregateste coletul la
 * magazin si da clientului un cod de ridicare; starea ramane `CREATED` pana cand ADMIN marcheaza comanda ca livrata.
 * Id-urile sunt unice pe pornire (aceeasi lectie ca la mock-urile curierilor: tabela `shipments` are id extern unic).
 */
export class StorePickupCourier implements CourierService {
  private readonly prepared = new Set<string>();
  private readonly runId = newRunId();
  private sequence = 0;

  /** Nu foloseste datele coletului: nu exista curier caruia sa i le trimita. */
  createShipment(_request: CreateCourierShipmentRequest): Promise<CourierShipment> {
    const code = `PICKUP-${this.runId.toUpperCase()}-${String(++this.sequence).padStart(5, '0')}`;
    this.prepared.add(code);
    return Promise.resolve({ externalId: code, trackingNumber: code });
  }

  track(externalId: string): Promise<CourierTracking> {
    if (!this.prepared.has(externalId)) {
      // Dupa o repornire coletul nu mai e cunoscut in memorie; urmarirea e informativa, deci cade pe ultima stare salvata.
      return Promise.reject(new CourierProviderError('Cod de ridicare necunoscut'));
    }
    return Promise.resolve({ status: 'CREATED' });
  }
}
