import { ConflictError } from '../../../../shared';
import type { Email } from '../../domain/Email';
import type { User } from '../../domain/User';
import type { UserRepository } from '../../ports/out/UserRepository';

/** Adaptor in-memory pentru `UserRepository`. */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, User>();

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByEmail(email: Email): Promise<User | null> {
    return Promise.resolve(this.byEmail.get(email.value) ?? null);
  }

  save(user: User): Promise<void> {
    if (this.byEmail.has(user.email.value) || this.byId.has(user.id)) {
      return Promise.reject(new ConflictError('Exista deja un cont cu acest email', 'EMAIL_TAKEN'));
    }
    this.byId.set(user.id, user);
    this.byEmail.set(user.email.value, user);
    return Promise.resolve();
  }
}
