import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { Money } from '../../../../shared';
import { Product } from '../../domain/Product';
import type { Page, ProductFilter, ProductRepository } from '../../ports/out/ProductRepository';

function toDomain(row: Prisma.ProductModel): Product {
  return Product.create({
    id: row.id,
    name: row.name,
    description: row.description,
    price: Money.of(row.priceAmount, row.currency),
    stock: row.stock,
    categoryId: row.categoryId,
  });
}

/** Prisma nu scapa wildcard-urile LIKE: le scapam noi, ca "100%" sa fie cautat literal. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function toRow(product: Product): Prisma.ProductUncheckedCreateInput {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceAmount: product.price.amount,
    currency: product.price.currency,
    stock: product.stock,
    categoryId: product.categoryId,
  };
}

/** Adaptor Prisma/PostgreSQL pentru `ProductRepository`. */
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toDomain);
  }

  async findMany(filter: ProductFilter): Promise<Page<Product>> {
    const conditions: Prisma.ProductWhereInput[] = [];
    if (filter.query) {
      const text = escapeLike(filter.query);
      conditions.push({
        OR: [
          { name: { contains: text, mode: 'insensitive' } },
          { description: { contains: text, mode: 'insensitive' } },
        ],
      });
    }
    if (filter.categoryIds) {
      conditions.push({ categoryId: { in: [...filter.categoryIds] } });
    }
    const where: Prisma.ProductWhereInput = { AND: conditions };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: filter.offset,
        take: filter.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async save(product: Product): Promise<void> {
    const data = toRow(product);
    await orConflict(
      () => this.prisma.product.upsert({ where: { id: product.id }, create: data, update: data }),
      'Categoria produsului nu mai exista sau a fost modificata simultan',
    );
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await orConflict(
      () => this.prisma.product.deleteMany({ where: { id } }),
      'Produsul este folosit intr-un pachet si nu poate fi sters',
      'PRODUCT_IN_BUNDLE',
    );
    return count > 0;
  }

  countByCategories(categoryIds: readonly string[]): Promise<number> {
    return this.prisma.product.count({ where: { categoryId: { in: [...categoryIds] } } });
  }
}
