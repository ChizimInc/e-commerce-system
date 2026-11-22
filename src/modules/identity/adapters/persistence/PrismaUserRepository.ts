import type { Prisma, PrismaClient } from '../../../../infrastructure/persistence/prisma-client';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../../../../infrastructure/persistence/prisma-errors';
import { ConflictError } from '../../../../shared';
import { Email } from '../../domain/Email';
import { User } from '../../domain/User';
import type { UserRepository } from '../../ports/out/UserRepository';

function toDomain(row: Prisma.UserModel): User {
  return new User({
    id: row.id,
    email: Email.of(row.email),
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: row.createdAt,
  });
}

/** Adaptor Prisma/PostgreSQL pentru `UserRepository` (tabelul `users`, email unic). */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.value } });
    return row ? toDomain(row) : null;
  }

  async save(user: User): Promise<void> {
    try {
      await this.prisma.user.create({
        data: {
          id: user.id,
          email: user.email.value,
          passwordHash: user.passwordHash,
          role: user.role,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictError('Exista deja un cont cu acest email', 'EMAIL_TAKEN');
      }
      throw error;
    }
  }
}
