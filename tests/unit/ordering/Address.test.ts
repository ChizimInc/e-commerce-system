import { describe, expect, it } from 'vitest';
import { Address } from '../../../src/modules/ordering/domain/Address';
import { ADDRESS_PROPS, makeAddress } from '../../helpers/order-fixtures';

describe('Address (value object)', () => {
  it('normalizeaza spatiile si tara (litere mari)', () => {
    const address = Address.of({
      recipientName: '  Ana Popescu ',
      street: ' Str. Libertatii 10',
      city: 'Chisinau ',
      postalCode: ' MD-2001 ',
      country: ' md ',
    });
    expect(address.toJSON()).toEqual(ADDRESS_PROPS);
  });

  it('doua adrese cu aceleasi campuri sunt egale', () => {
    expect(makeAddress().equals(makeAddress())).toBe(true);
    expect(makeAddress().equals(makeAddress({ city: 'Balti' }))).toBe(false);
  });

  it.each(['recipientName', 'street', 'city', 'postalCode'] as const)(
    'refuza campul %s gol, cu codul INVALID_ADDRESS',
    (field) => {
      expect(() => makeAddress({ [field]: '   ' })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ADDRESS' }) as Error,
      );
    },
  );

  it.each(['R', 'ROM', '12', ''])('refuza tara invalida "%s"', (country) => {
    expect(() => makeAddress({ country })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ADDRESS' }) as Error,
    );
  });

  it('refuza campurile prea lungi', () => {
    expect(() => makeAddress({ street: 'x'.repeat(201) })).toThrowError(/maximum 200/);
  });
});
