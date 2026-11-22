import { ConflictError, NotFoundError, type IdGenerator } from '../../../shared';
import { Cart } from '../domain/Cart';
import { PricedCart, type PricedLine } from '../domain/PricedCart';
import type { CartUseCases } from '../ports/in/CartUseCases';
import type { CartRepository } from '../ports/out/CartRepository';
import type { CatalogLookup, PurchasableItem } from '../ports/out/CatalogLookup';

/** Cazurile de utilizare ale cosului: adaugare, modificare cantitate, stergere, total, validare stoc. */
export class CartService implements CartUseCases {
  constructor(
    private readonly carts: CartRepository,
    private readonly catalog: CatalogLookup,
    private readonly ids: IdGenerator,
  ) {}

  async getCart(userId: string): Promise<PricedCart> {
    return this.price(await this.load(userId));
  }

  async addItem(userId: string, itemId: string, quantity: number): Promise<PricedCart> {
    const cart = await this.load(userId);
    const item = await this.requireItem(itemId);
    const updated = cart.addItem(itemId, quantity);
    this.assertStock(item, updated.quantityOf(itemId));
    return this.persist(updated);
  }

  async updateQuantity(userId: string, itemId: string, quantity: number): Promise<PricedCart> {
    const cart = await this.load(userId);
    const updated = cart.setQuantity(itemId, quantity);
    this.assertStock(await this.requireItem(itemId), quantity);
    return this.persist(updated);
  }

  async removeItem(userId: string, itemId: string): Promise<PricedCart> {
    // Fara cautare in catalog: un articol disparut din catalog trebuie sa poata fi scos din cos.
    return this.persist((await this.load(userId)).removeItem(itemId));
  }

  async clear(userId: string): Promise<PricedCart> {
    return this.persist((await this.load(userId)).clear());
  }

  private async load(userId: string): Promise<Cart> {
    return (await this.carts.findByUserId(userId)) ?? Cart.empty(this.ids.next(), userId);
  }

  /** Calculeaza vederea cosului (inainte de salvare), apoi salveaza: un cos invalid nu se persista. */
  private async persist(cart: Cart): Promise<PricedCart> {
    const priced = await this.price(cart);
    // Articolele disparute din catalog nu apar in vedere, deci nu le mai pastram nici in cos
    // (altfel ar ramane invizibile, dar ar continua sa ocupe locuri din limita de articole).
    const live = new Set(priced.lines.map((line) => line.itemId));
    await this.carts.save(cart.retainOnly(live));
    return priced;
  }

  /** Rezolva articolele cu datele curente din catalog; cele disparute din catalog nu apar in vedere. */
  private async price(cart: Cart): Promise<PricedCart> {
    const resolved = await Promise.all(
      cart.items.map(async ({ itemId, quantity }): Promise<PricedLine | null> => {
        const item = await this.catalog.find(itemId);
        return item
          ? {
              itemId,
              name: item.name,
              unitPrice: item.unitPrice,
              quantity,
              availableStock: item.availableStock,
            }
          : null;
      }),
    );
    return PricedCart.of(resolved.filter((line): line is PricedLine => line !== null));
  }

  private async requireItem(itemId: string): Promise<PurchasableItem> {
    const item = await this.catalog.find(itemId);
    if (!item) throw new NotFoundError('Produs', itemId);
    return item;
  }

  private assertStock(item: PurchasableItem, requested: number): void {
    if (requested > item.availableStock) {
      throw new ConflictError(
        `Stoc insuficient pentru "${item.name}": ai cerut ${requested}, disponibil ${item.availableStock}`,
        'INSUFFICIENT_STOCK',
      );
    }
  }
}
