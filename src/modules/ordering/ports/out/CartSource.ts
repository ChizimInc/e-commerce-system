import type { ConsumedCartLine } from './OrderPlacement';

/** Port de iesire (anti-corruption layer spre `cart`): de unde isi ia comanda articolele. */
export interface CartSource {
  /** Liniile cosului utilizatorului (fara articolele disparute din catalog); lista goala daca nu are cos. */
  linesOf(userId: string): Promise<readonly ConsumedCartLine[]>;
}
