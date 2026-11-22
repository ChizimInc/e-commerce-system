import { DomainError, type Money } from '../../../shared';
import type { CatalogItem } from './CatalogItem';
import { Product } from './Product';
import { optionalText, requireIntegerInRange, requireText } from './validation';

export const MAX_BUNDLE_DISCOUNT_PERCENT = 90;
export const MAX_COMPONENT_QUANTITY = 100;
export const MAX_BUNDLE_COMPONENTS = 50;

export interface BundleComponent {
  readonly item: CatalogItem;
  readonly quantity: number;
}

export interface BundleProps {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Reducerea pachetului fata de suma preturilor componentelor (0-90%). */
  readonly discountPercent: number;
  readonly components: readonly BundleComponent[];
}

/** Campurile modificabile ale unui pachet; `undefined` = ramane neschimbat. */
export type BundleChanges = {
  readonly [K in keyof Omit<BundleProps, 'id'>]?: BundleProps[K] | undefined;
};

// Pattern: Composite (Structural) – compusul: Bundle contine CatalogItem-uri (Product sau alt Bundle) si isi calculeaza pretul din ele
export class Bundle implements CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly discountPercent: number;
  readonly components: readonly BundleComponent[];

  private constructor(props: BundleProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.discountPercent = props.discountPercent;
    this.components = props.components;
  }

  static create(props: BundleProps): Bundle {
    const components = props.components;
    if (components.length === 0) {
      throw new DomainError(
        'Un pachet trebuie sa contina cel putin o componenta',
        'VALIDATION_ERROR',
      );
    }
    if (components.length > MAX_BUNDLE_COMPONENTS) {
      throw new DomainError(
        `Un pachet poate avea maximum ${MAX_BUNDLE_COMPONENTS} de componente`,
        'VALIDATION_ERROR',
      );
    }
    const seen = new Set<string>();
    for (const component of components) {
      requireIntegerInRange(
        component.quantity,
        'Cantitatea componentei',
        1,
        MAX_COMPONENT_QUANTITY,
      );
      if (component.item.id === props.id) {
        throw new DomainError('Un pachet nu se poate contine pe sine', 'VALIDATION_ERROR');
      }
      if (seen.has(component.item.id)) {
        throw new DomainError(
          `Componenta apare de mai multe ori in pachet: ${component.item.id}`,
          'VALIDATION_ERROR',
        );
      }
      seen.add(component.item.id);
    }
    const bundle = new Bundle({
      id: props.id,
      name: requireText(props.name, 'Numele pachetului', 200),
      description: optionalText(props.description, 'Descrierea pachetului', 2000),
      discountPercent: requireIntegerInRange(
        props.discountPercent,
        'Reducerea',
        0,
        MAX_BUNDLE_DISCOUNT_PERCENT,
      ),
      components: [...components],
    });
    bundle.getPrice(); // valideaza din start ca toate componentele au aceeasi moneda
    return bundle;
  }

  /** Suma preturilor componentelor (x cantitate), minus reducerea pachetului. */
  getPrice(): Money {
    const [first, ...rest] = this.components;
    if (!first) {
      throw new DomainError('Pachet fara componente', 'VALIDATION_ERROR');
    }
    const lineTotal = (component: BundleComponent): Money =>
      component.item.getPrice().multiply(component.quantity);
    const subtotal = rest.reduce(
      (sum, component) => sum.add(lineTotal(component)),
      lineTotal(first),
    );
    return subtotal.subtract(subtotal.percentage(this.discountPercent));
  }

  /** Cate pachete complete se pot forma din stocul curent al componentelor. */
  availableStock(): number {
    return Math.min(
      ...this.components.map((component) =>
        Math.floor(component.item.availableStock() / component.quantity),
      ),
    );
  }

  /**
   * Componentele ca produse simple (necesar pentru persistenta, care stocheaza doar legaturi
   * pachet -> produs). Pachetele imbricate exista in domeniu, dar nu se pot salva inca.
   */
  productComponents(): { product: Product; quantity: number }[] {
    return this.components.map(({ item, quantity }) => {
      if (!(item instanceof Product)) {
        throw new DomainError(
          'Pachetele imbricate nu pot fi salvate: componentele trebuie sa fie produse',
          'NESTED_BUNDLE_NOT_SUPPORTED',
        );
      }
      return { product: item, quantity };
    });
  }

  withChanges(changes: BundleChanges): Bundle {
    return Bundle.create({
      id: this.id,
      name: changes.name ?? this.name,
      description: changes.description ?? this.description,
      discountPercent: changes.discountPercent ?? this.discountPercent,
      components: changes.components ?? this.components,
    });
  }
}
