import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/shared';

class OutOfStockError extends DomainError {
  constructor(sku: string) {
    super(`Stoc insuficient pentru ${sku}`, 'OUT_OF_STOCK');
  }
}

describe('DomainError', () => {
  it('este o Error cu cod implicit', () => {
    const error = new DomainError('ceva nu e in regula');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('DOMAIN_ERROR');
    expect(error.message).toBe('ceva nu e in regula');
  });

  it('subclasele pastreaza numele si codul propriu', () => {
    const error = new OutOfStockError('SKU-1');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('OutOfStockError');
    expect(error.code).toBe('OUT_OF_STOCK');
  });

  it('pastreaza cauza originala', () => {
    const cause = new Error('cauza');
    expect(new DomainError('x', 'X', { cause }).cause).toBe(cause);
  });
});
