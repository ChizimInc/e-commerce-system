import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { Money } from '../../../../shared';
import { Bundle } from '../../domain/Bundle';
import { Product } from '../../domain/Product';
import type { BundleRepository } from '../../ports/out/BundleRepository';

const WITH_ITEMS = {
  items: {
    include: { product: true },
    orderBy: [{ product: { name: 'asc' } }, { productId: 'asc' }],
  },
} satisfies Prisma.BundleInclude;

type BundleRow = Prisma.BundleGetPayload<{ include: typeof WITH_ITEMS }>;

function toDomain(row: BundleRow): Bundle {
  return Bundle.create({
    id: row.id,
    name: row.name,
    description: row.description,
    discountPercent: row.discountPercent,
    components: row.items.map((item) => ({
      item: Product.create({
        id: item.product.id,
        name: item.product.name,
        description: item.product.description,
        price: Money.of(item.product.priceAmount, item.product.currency),
        stock: item.product.stock,
        categoryId: item.product.categoryId,
      }),
      quantity: item.quantity,
    })),
  });
}

/** Adaptor Prisma/PostgreSQL pentru `BundleRepository` (tabelele `bundles` + `bundle_items`). */
export class PrismaBundleRepository implements BundleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Bundle | null> {
    const row = await this.prisma.bundle.findUnique({ where: { id }, include: WITH_ITEMS });
    return row ? toDomain(row) : null;
  }

  async findAll(): Promise<Bundle[]> {
    const rows = await this.prisma.bundle.findMany({ include: WITH_ITEMS });
    return rows.map(toDomain);
  }

  async save(bundle: Bundle): Promise<void> {
    const components = bundle.productComponents();
    const data = {
      name: bundle.name,
      description: bundle.description,
      discountPercent: bundle.discountPercent,
    };
    // O singura tranzactie: pachetul si componentele lui se salveaza impreuna sau deloc.
    await orConflict(
      () =>
        this.prisma.$transaction([
          this.prisma.bundle.upsert({
            where: { id: bundle.id },
            create: { id: bundle.id, ...data },
            update: data,
          }),
          this.prisma.bundleItem.deleteMany({ where: { bundleId: bundle.id } }),
          this.prisma.bundleItem.createMany({
            data: components.map(({ product, quantity }) => ({
              bundleId: bundle.id,
              productId: product.id,
              quantity,
            })),
          }),
        ]),
      'Pachetul sau un produs din el a fost modificat simultan, reincearca',
    );
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.bundle.deleteMany({ where: { id } });
    return count > 0;
  }

  async existsWithProduct(productId: string): Promise<boolean> {
    const row = await this.prisma.bundleItem.findFirst({ where: { productId } });
    return row !== null;
  }
}
