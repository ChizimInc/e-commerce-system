import { DomainError } from '../../../shared';
import { requireText } from './validation';

export interface AddressProps {
  readonly recipientName: string;
  readonly street: string;
  readonly city: string;
  readonly postalCode: string;
  /** Cod de tara ISO 3166-1 alpha-2 (ex. `RO`). */
  readonly country: string;
}

/** Value object imutabil: adresa de livrare a unei comenzi. Doua adrese cu aceleasi campuri sunt egale. */
export class Address {
  readonly recipientName: string;
  readonly street: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;

  private constructor(props: AddressProps) {
    this.recipientName = props.recipientName;
    this.street = props.street;
    this.city = props.city;
    this.postalCode = props.postalCode;
    this.country = props.country;
  }

  /** Singura cale de a construi o adresa: valideaza si normalizeaza campurile. */
  static of(props: AddressProps): Address {
    const country = props.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new DomainError(
        'Tara trebuie sa fie un cod ISO de 2 litere (ex. RO)',
        'INVALID_ADDRESS',
      );
    }
    try {
      return new Address({
        recipientName: requireText(props.recipientName, 'Destinatarul', 100),
        street: requireText(props.street, 'Strada', 200),
        city: requireText(props.city, 'Orasul', 100),
        postalCode: requireText(props.postalCode, 'Codul postal', 20),
        country,
      });
    } catch (error) {
      // Toate erorile de validare ale adresei au acelasi cod, ca clientul sa le poata trata uniform.
      if (error instanceof DomainError) throw new DomainError(error.message, 'INVALID_ADDRESS');
      throw error;
    }
  }

  equals(other: Address): boolean {
    return (
      this.recipientName === other.recipientName &&
      this.street === other.street &&
      this.city === other.city &&
      this.postalCode === other.postalCode &&
      this.country === other.country
    );
  }

  toJSON(): AddressProps {
    return {
      recipientName: this.recipientName,
      street: this.street,
      city: this.city,
      postalCode: this.postalCode,
      country: this.country,
    };
  }
}
