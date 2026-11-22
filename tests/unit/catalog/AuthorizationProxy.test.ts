import { describe, expect, it } from 'vitest';
import {
  ConsoleLogger,
  ForbiddenError,
  UnauthorizedError,
  type Principal,
} from '../../../src/shared';
import { AuthorizationProxy } from '../../../src/modules/catalog/application/AuthorizationProxy';
import type { CatalogAdminService } from '../../../src/modules/catalog/ports/in/CatalogAdminService';
import { makeCategory, makeProduct } from '../../helpers/catalog-fixtures';
import { uuid } from '../../helpers/ids';

/** Subiect real simulat: inregistreaza ce operatii au ajuns efectiv la el. */
function spyService() {
  const calls: string[] = [];
  const product = makeProduct();
  const category = makeCategory(uuid(5), 'Cat');
  const record = <T>(name: string, result: T) => {
    calls.push(name);
    return Promise.resolve(result);
  };
  const service = {
    createProduct: () => record('createProduct', product),
    updateProduct: () => record('updateProduct', product),
    deleteProduct: () => record('deleteProduct', undefined),
    createCategory: () => record('createCategory', category),
    updateCategory: () => record('updateCategory', category),
    deleteCategory: () => record('deleteCategory', undefined),
    createBundle: () => record('createBundle', {} as never),
    updateBundle: () => record('updateBundle', {} as never),
    deleteBundle: () => record('deleteBundle', undefined),
  } satisfies CatalogAdminService;
  return { calls, service, product, category };
}

const admin: Principal = { userId: uuid(1), role: 'ADMIN' };
const customer: Principal = { userId: uuid(2), role: 'CUSTOMER' };

type Operation = (service: CatalogAdminService) => Promise<unknown>;
const priceInput = { amount: 1, currency: 'RON' as const };
const operations: [string, Operation][] = [
  ['createProduct', (s) => s.createProduct({ name: 'x', price: priceInput, stock: 1 })],
  ['updateProduct', (s) => s.updateProduct(uuid(1), { stock: 1 })],
  ['deleteProduct', (s) => s.deleteProduct(uuid(1))],
  ['createCategory', (s) => s.createCategory({ name: 'x' })],
  ['updateCategory', (s) => s.updateCategory(uuid(1), { name: 'y' })],
  ['deleteCategory', (s) => s.deleteCategory(uuid(1))],
  ['createBundle', (s) => s.createBundle({ name: 'x', items: [] })],
  ['updateBundle', (s) => s.updateBundle(uuid(1), { name: 'y' })],
  ['deleteBundle', (s) => s.deleteBundle(uuid(1))],
];

// Proxy (S4, partea a doua): protejeaza operatiile de administrare independent de middleware-ul HTTP.
describe('AuthorizationProxy (Proxy de protectie)', () => {
  it.each(operations)(
    '%s: ADMIN este lasat sa treaca si rezultatul real e returnat',
    async (name, run) => {
      const { calls, service } = spyService();
      await run(new AuthorizationProxy(service, admin));
      expect(calls).toEqual([name]);
    },
  );

  it.each(operations)(
    '%s: CUSTOMER primeste ForbiddenError si subiectul real nu e apelat',
    async (_name, run) => {
      const { calls, service } = spyService();
      await expect(run(new AuthorizationProxy(service, customer))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(operations)(
    '%s: apelantul anonim primeste UnauthorizedError si subiectul real nu e apelat',
    async (_name, run) => {
      const { calls, service } = spyService();
      await expect(run(new AuthorizationProxy(service, null))).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(calls).toEqual([]);
    },
  );

  it('intoarce exact rezultatul subiectului real', async () => {
    const { service, product } = spyService();
    const proxy = new AuthorizationProxy(service, admin);
    expect(await proxy.createProduct({ name: 'x', price: priceInput, stock: 1 })).toBe(product);
  });

  it('respingerea este o promisiune respinsa (nu o exceptie sincrona)', async () => {
    const { service } = spyService();
    const proxy = new AuthorizationProxy(service, null);
    let pending: Promise<void> | undefined;
    expect(() => (pending = proxy.deleteProduct(uuid(1)))).not.toThrow();
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('propaga erorile subiectului real neschimbate', async () => {
    const failing: CatalogAdminService = {
      ...spyService().service,
      deleteProduct: () => Promise.reject(new Error('eroare din subiect')),
    };
    await expect(new AuthorizationProxy(failing, admin).deleteProduct(uuid(1))).rejects.toThrow(
      'eroare din subiect',
    );
  });

  it('logheaza incercarile respinse (fara date sensibile)', async () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger('warn', {}, (_level, line) => lines.push(line));
    const { service } = spyService();
    await new AuthorizationProxy(service, customer, logger)
      .deleteProduct(uuid(1))
      .catch(() => undefined);
    await new AuthorizationProxy(service, null, logger)
      .deleteProduct(uuid(1))
      .catch(() => undefined);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('rol insuficient');
    expect(lines[0]).toContain('deleteProduct');
    expect(lines[1]).toContain('neautentificat');
  });
});
