import type { Money } from '../../../../shared';

/** Ce trebuie sa stie cotatia de livrare despre cosul clientului: valoarea marfii si numarul de bucati. */
export interface CartQuoteBasis {
  readonly itemsValue: Money;
  readonly units: number;
}

/** Port de iesire: legatura cu cosul (anti-corruption layer catre modulul `cart`). */
export interface QuotableCart {
  /** Baza de calcul a cosului utilizatorului; `units` = 0 daca e gol. */
  basisOf(userId: string): Promise<CartQuoteBasis>;
}
