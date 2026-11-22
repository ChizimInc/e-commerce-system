import { ConflictError, type IdGenerator } from '../../../shared';
import { Email } from '../domain/Email';
import { assertValidPassword } from '../domain/Password';
import { User } from '../domain/User';
import type { PasswordHasher } from '../ports/out/PasswordHasher';
import type { UserRepository } from '../ports/out/UserRepository';

/**
 * Creeaza contul de administrator initial (folosit de scriptul de seed). Conturile ADMIN nu se pot
 * crea prin API-ul public de inregistrare, deci administratorul de pornire se creeaza aici.
 * Este idempotent: daca emailul exista deja, nu modifica nimic.
 */
export class BootstrapAdmin {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async execute(rawEmail: string, password: string): Promise<'created' | 'exists'> {
    const email = Email.of(rawEmail);
    assertValidPassword(password);
    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (!existing.isAdmin()) {
        // Ex. cineva a inregistrat public emailul administratorului inaintea seed-ului.
        throw new ConflictError(
          `Emailul ${email.value} exista deja ca ${existing.role}, nu ca ADMIN: foloseste alt SEED_ADMIN_EMAIL`,
          'ADMIN_EMAIL_TAKEN',
        );
      }
      return 'exists';
    }
    await this.users.save(
      new User({
        id: this.ids.next(),
        email,
        passwordHash: await this.hasher.hash(password),
        role: 'ADMIN',
        createdAt: new Date(),
      }),
    );
    return 'created';
  }
}
