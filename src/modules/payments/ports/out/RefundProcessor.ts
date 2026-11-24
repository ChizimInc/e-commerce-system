import type { Payment } from '../../domain/Payment';
import type { Refund } from './PaymentGateway';

/**
 * Port de iesire (parte din familia unui furnizor): ramburseaza o plata dupa regulile furnizorului ei
 * (ferestre de timp, tipuri de rambursare), folosind gateway-ul din aceeasi familie.
 */
export interface RefundProcessor {
  /** `payment` e in starea REFUNDING (revendicata de apelant). Arunca erorile gateway-ului sau `PaymentRejectedError`. */
  refund(payment: Payment): Promise<Refund>;
}
