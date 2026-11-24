import { DomainError } from '../../../shared';
import type { CourierCode, DeliveryMethod } from '../domain/ShippingTypes';
import type { CourierService } from '../ports/out/CourierService';

/**
 * Registrul curierilor: ce curier duce fiecare metoda de livrare si cum se ajunge la serviciul lui.
 * Se asambleaza in composition root; un curier nou se adauga acolo (si in `COURIERS`), fara sa se modifice cazurile de utilizare.
 */
export class CourierDirectory {
  constructor(
    private readonly services: Readonly<Record<CourierCode, CourierService>>,
    private readonly byMethod: Readonly<Record<DeliveryMethod, CourierCode>>,
  ) {}

  /** Curierul care duce coletele unei metode de livrare. */
  courierFor(method: DeliveryMethod): CourierCode {
    return this.byMethod[method];
  }

  serviceOf(courier: CourierCode): CourierService {
    // `Record` garanteaza ca toti curierii sunt inregistrati, dar o valoare salvata veche ar putea fi necunoscuta.
    const service = this.services[courier] as CourierService | undefined;
    if (!service) {
      throw new DomainError(`Curier necunoscut: ${courier}`, 'UNKNOWN_COURIER');
    }
    return service;
  }
}
