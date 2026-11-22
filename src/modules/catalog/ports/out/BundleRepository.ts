import type { Bundle } from '../../domain/Bundle';

/**
 * Port de iesire pentru persistenta pachetelor. Pachetele se salveaza ca legaturi
 * pachet -> produs (+ cantitate) si se reconstruiesc cu preturile/stocurile curente ale produselor.
 */
export interface BundleRepository {
  findById(id: string): Promise<Bundle | null>;
  findAll(): Promise<Bundle[]>;
  /** Insereaza sau actualizeaza (upsert); componentele trebuie sa fie produse. */
  save(bundle: Bundle): Promise<void>;
  /** Intoarce `false` daca pachetul nu exista. */
  delete(id: string): Promise<boolean>;
  /** Este produsul component al vreunui pachet? */
  existsWithProduct(productId: string): Promise<boolean>;
}
