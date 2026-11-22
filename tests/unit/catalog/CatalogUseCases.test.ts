import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, DomainError, NotFoundError } from '../../../src/shared';
import { CatalogAdminUseCases } from '../../../src/modules/catalog/application/CatalogAdminUseCases';
import { CatalogQueryService } from '../../../src/modules/catalog/application/CatalogQueryService';
import { createInMemoryRepositories } from '../../../src/composition-root';
import { SequentialIdGenerator, uuid } from '../../helpers/ids';
import { silentLogger } from '../../helpers/silent-logger';

function setup() {
  const repositories = createInMemoryRepositories();
  const admin = new CatalogAdminUseCases(
    repositories.products,
    repositories.categories,
    repositories.bundles,
    new SequentialIdGenerator(),
    silentLogger,
  );
  const queries = new CatalogQueryService(
    repositories.products,
    repositories.categories,
    repositories.bundles,
  );
  return { admin, queries, repositories };
}

const price = (amount: number) => ({ amount, currency: 'RON' as const });

describe('CatalogAdminUseCases: produse', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creeaza un produs cu id generat si valori implicite', async () => {
    const product = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    expect(product.id).toBe(uuid(1000));
    expect(product.description).toBe('');
    expect(product.categoryId).toBeNull();
    expect(await ctx.queries.getProduct(product.id)).toEqual(product);
  });

  it('refuza un produs intr-o categorie inexistenta', async () => {
    await expect(
      ctx.admin.createProduct({ name: 'X', price: price(1), stock: 1, categoryId: uuid(77) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('actualizeaza doar campurile trimise (inclusiv stocul)', async () => {
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    const updated = await ctx.admin.updateProduct(id, { stock: 8 });
    expect(updated).toMatchObject({ name: 'Mouse', stock: 8 });
    expect(updated.price.amount).toBe(5000);
  });

  it('refuza actualizarea unui produs inexistent si valorile invalide', async () => {
    await expect(ctx.admin.updateProduct(uuid(1), { stock: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    await expect(ctx.admin.updateProduct(id, { stock: -1 })).rejects.toBeInstanceOf(DomainError);
  });

  it('sterge un produs; o a doua stergere da NotFound', async () => {
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    await ctx.admin.deleteProduct(id);
    await expect(ctx.queries.getProduct(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.admin.deleteProduct(id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nu schimba moneda unui produs din pachet (ar strica pachetul), dar permite alte modificari', async () => {
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    await ctx.admin.createBundle({ name: 'Set', items: [{ productId: id, quantity: 1 }] });
    await expect(
      ctx.admin.updateProduct(id, { price: { amount: 5000, currency: 'EUR' } }),
    ).rejects.toMatchObject({ code: 'PRODUCT_IN_BUNDLE' });
    await expect(ctx.admin.updateProduct(id, { price: price(6000) })).resolves.toBeDefined();
    expect((await ctx.queries.listBundles())[0]?.getPrice().currency).toBe('RON');
  });

  it('schimba moneda unui produs care nu e in niciun pachet', async () => {
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    const updated = await ctx.admin.updateProduct(id, { price: { amount: 5000, currency: 'EUR' } });
    expect(updated.price.currency).toBe('EUR');
  });

  it('nu sterge un produs care face parte dintr-un pachet', async () => {
    const { id } = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 3 });
    await ctx.admin.createBundle({ name: 'Set', items: [{ productId: id, quantity: 1 }] });
    await expect(ctx.admin.deleteProduct(id)).rejects.toMatchObject({ code: 'PRODUCT_IN_BUNDLE' });
  });
});

describe('CatalogAdminUseCases: categorii', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creeaza ierarhii si le expune ca arbore', async () => {
    const root = await ctx.admin.createCategory({ name: 'Electronice' });
    await ctx.admin.createCategory({ name: 'Laptopuri', parentId: root.id });
    const tree = await ctx.queries.listCategories();
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.name)).toEqual(['Laptopuri']);
  });

  it('refuza un parinte inexistent si numele duplicat pe acelasi nivel (case-insensitive)', async () => {
    await expect(
      ctx.admin.createCategory({ name: 'X', parentId: uuid(77) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await ctx.admin.createCategory({ name: 'Carti' });
    await expect(ctx.admin.createCategory({ name: 'carti' })).rejects.toMatchObject({
      code: 'CATEGORY_NAME_TAKEN',
    });
  });

  it('acelasi nume e permis sub parinti diferiti', async () => {
    const a = await ctx.admin.createCategory({ name: 'A' });
    const b = await ctx.admin.createCategory({ name: 'B' });
    await ctx.admin.createCategory({ name: 'Accesorii', parentId: a.id });
    await expect(
      ctx.admin.createCategory({ name: 'Accesorii', parentId: b.id }),
    ).resolves.toBeDefined();
  });

  it('muta o categorie, dar refuza ciclurile (sub propriul subarbore)', async () => {
    const a = await ctx.admin.createCategory({ name: 'A' });
    const b = await ctx.admin.createCategory({ name: 'B', parentId: a.id });
    const c = await ctx.admin.createCategory({ name: 'C', parentId: b.id });

    await expect(ctx.admin.updateCategory(a.id, { parentId: c.id })).rejects.toMatchObject({
      code: 'CATEGORY_CYCLE',
    });
    await expect(ctx.admin.updateCategory(a.id, { parentId: a.id })).rejects.toBeInstanceOf(
      DomainError,
    );
    const moved = await ctx.admin.updateCategory(c.id, { parentId: null });
    expect(moved.parentId).toBeNull();
  });

  it('nu sterge categorii cu subcategorii sau cu produse; sterge una goala', async () => {
    const parent = await ctx.admin.createCategory({ name: 'Parinte' });
    const child = await ctx.admin.createCategory({ name: 'Copil', parentId: parent.id });
    await expect(ctx.admin.deleteCategory(parent.id)).rejects.toBeInstanceOf(ConflictError);

    await ctx.admin.createProduct({
      name: 'P',
      price: price(1),
      stock: 1,
      categoryId: child.id,
    });
    await expect(ctx.admin.deleteCategory(child.id)).rejects.toBeInstanceOf(ConflictError);

    const empty = await ctx.admin.createCategory({ name: 'Goala' });
    await ctx.admin.deleteCategory(empty.id);
    await expect(ctx.admin.deleteCategory(empty.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('CatalogAdminUseCases: pachete', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creeaza un pachet cu pret calculat si il actualizeaza (reducere, componente)', async () => {
    const mouse = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 10 });
    const pad = await ctx.admin.createProduct({ name: 'Covoras', price: price(2000), stock: 10 });
    const bundle = await ctx.admin.createBundle({
      name: 'Set',
      discountPercent: 10,
      items: [
        { productId: mouse.id, quantity: 1 },
        { productId: pad.id, quantity: 2 },
      ],
    });
    expect(bundle.getPrice().amount).toBe(8100); // (5000 + 4000) - 10%

    const updated = await ctx.admin.updateBundle(bundle.id, {
      discountPercent: 0,
      items: [{ productId: pad.id, quantity: 1 }],
    });
    expect(updated.getPrice().amount).toBe(2000);
    expect((await ctx.queries.getBundle(bundle.id)).components).toHaveLength(1);
  });

  it('pretul pachetului urmareste modificarile produselor (preturi proaspete)', async () => {
    const mouse = await ctx.admin.createProduct({ name: 'Mouse', price: price(5000), stock: 10 });
    const bundle = await ctx.admin.createBundle({
      name: 'Set',
      items: [{ productId: mouse.id, quantity: 2 }],
    });
    await ctx.admin.updateProduct(mouse.id, { price: price(6000), stock: 5 });
    const reloaded = await ctx.queries.getBundle(bundle.id);
    expect(reloaded.getPrice().amount).toBe(12_000);
    expect(reloaded.availableStock()).toBe(2);
  });

  it('refuza componente inexistente, duplicate sau in monede diferite', async () => {
    const ron = await ctx.admin.createProduct({ name: 'Ron', price: price(100), stock: 1 });
    const eur = await ctx.admin.createProduct({
      name: 'Eur',
      price: { amount: 100, currency: 'EUR' },
      stock: 1,
    });
    await expect(
      ctx.admin.createBundle({ name: 'X', items: [{ productId: uuid(77), quantity: 1 }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ctx.admin.createBundle({
        name: 'X',
        items: [
          { productId: ron.id, quantity: 1 },
          { productId: ron.id, quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      ctx.admin.createBundle({
        name: 'X',
        items: [
          { productId: ron.id, quantity: 1 },
          { productId: eur.id, quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'MONEY_CURRENCY_MISMATCH' });
  });

  it('listeaza pachetele sortate dupa nume si sterge un pachet', async () => {
    const p = await ctx.admin.createProduct({ name: 'P', price: price(100), stock: 1 });
    const items = [{ productId: p.id, quantity: 1 }];
    const b = await ctx.admin.createBundle({ name: 'B', items });
    await ctx.admin.createBundle({ name: 'A', items });
    expect((await ctx.queries.listBundles()).map((x) => x.name)).toEqual(['A', 'B']);
    await ctx.admin.deleteBundle(b.id);
    await expect(ctx.queries.getBundle(b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.admin.deleteBundle(b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.admin.updateBundle(b.id, { name: 'Z' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('CatalogQueryService', () => {
  let ctx: ReturnType<typeof setup>;
  let electronicsId: string;
  let laptopsId: string;

  beforeEach(async () => {
    ctx = setup();
    const electronics = await ctx.admin.createCategory({ name: 'Electronice' });
    const laptops = await ctx.admin.createCategory({ name: 'Laptopuri', parentId: electronics.id });
    const books = await ctx.admin.createCategory({ name: 'Carti' });
    electronicsId = electronics.id;
    laptopsId = laptops.id;
    await ctx.admin.createProduct({
      name: 'Laptop Pro',
      description: 'Pentru programatori',
      price: price(500_000),
      stock: 2,
      categoryId: laptops.id,
    });
    await ctx.admin.createProduct({
      name: 'Casti audio',
      price: price(20_000),
      stock: 5,
      categoryId: electronics.id,
    });
    await ctx.admin.createProduct({
      name: 'Roman SF',
      description: 'Un laptop apare in poveste',
      price: price(5000),
      stock: 9,
      categoryId: books.id,
    });
  });

  const names = (page: { items: { name: string }[] }) => page.items.map((p) => p.name);

  it('listeaza produsele sortate dupa nume, cu paginare', async () => {
    const all = await ctx.queries.listProducts({ limit: 10, offset: 0 });
    expect(names(all)).toEqual(['Casti audio', 'Laptop Pro', 'Roman SF']);
    expect(all.total).toBe(3);

    const second = await ctx.queries.listProducts({ limit: 1, offset: 1 });
    expect(names(second)).toEqual(['Laptop Pro']);
    expect(second).toMatchObject({ total: 3, limit: 1, offset: 1 });
  });

  it('cauta in nume si descriere, fara sa tina cont de litere mari/mici', async () => {
    const page = await ctx.queries.listProducts({ query: 'LAPTOP', limit: 10, offset: 0 });
    expect(names(page)).toEqual(['Laptop Pro', 'Roman SF']);
  });

  it('un text de cautare gol sau doar din spatii nu filtreaza', async () => {
    const page = await ctx.queries.listProducts({ query: '   ', limit: 10, offset: 0 });
    expect(page.total).toBe(3);
  });

  it('filtreaza pe categorie incluzand subcategoriile', async () => {
    const underElectronics = await ctx.queries.listProducts({
      categoryId: electronicsId,
      limit: 10,
      offset: 0,
    });
    expect(names(underElectronics)).toEqual(['Casti audio', 'Laptop Pro']);

    const onlyLaptops = await ctx.queries.listProducts({
      categoryId: laptopsId,
      limit: 10,
      offset: 0,
    });
    expect(names(onlyLaptops)).toEqual(['Laptop Pro']);
  });

  it('combina cautarea cu filtrul de categorie', async () => {
    const page = await ctx.queries.listProducts({
      query: 'laptop',
      categoryId: electronicsId,
      limit: 10,
      offset: 0,
    });
    expect(names(page)).toEqual(['Laptop Pro']);
  });

  it('da NotFound pentru o categorie inexistenta din filtru', async () => {
    await expect(
      ctx.queries.listProducts({ categoryId: uuid(77), limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('findItem trateaza uniform produsele si pachetele', async () => {
    const [laptop] = (await ctx.queries.listProducts({ query: 'Laptop Pro', limit: 1, offset: 0 }))
      .items;
    if (!laptop) throw new Error('lipseste produsul de test');
    const bundle = await ctx.admin.createBundle({
      name: 'Set',
      items: [{ productId: laptop.id, quantity: 1 }],
    });
    expect((await ctx.queries.findItem(laptop.id))?.getPrice().amount).toBe(500_000);
    expect((await ctx.queries.findItem(bundle.id))?.getPrice().amount).toBe(500_000);
    expect(await ctx.queries.findItem(uuid(77))).toBeNull();
  });
});
