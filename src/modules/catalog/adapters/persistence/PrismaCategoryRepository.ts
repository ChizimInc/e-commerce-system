import type { PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import { orConflict } from '../../../../infrastructure/persistence/prisma-errors';
import { Category } from '../../domain/Category';
import type { CategoryRepository } from '../../ports/out/CategoryRepository';

/** Adaptor Prisma/PostgreSQL pentru `CategoryRepository`. */
export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Category | null> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    return row ? Category.create(row) : null;
  }

  async findAll(): Promise<Category[]> {
    const rows = await this.prisma.category.findMany();
    return rows.map((row) => Category.create(row));
  }

  async save(category: Category): Promise<void> {
    const data = { id: category.id, name: category.name, parentId: category.parentId };
    await orConflict(
      () => this.prisma.category.upsert({ where: { id: category.id }, create: data, update: data }),
      'Categoria parinte nu mai exista sau a fost modificata simultan',
    );
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await orConflict(
      () => this.prisma.category.deleteMany({ where: { id } }),
      'Categoria nu este goala (subcategorii sau produse adaugate simultan)',
      'CATEGORY_NOT_EMPTY',
    );
    return count > 0;
  }
}
