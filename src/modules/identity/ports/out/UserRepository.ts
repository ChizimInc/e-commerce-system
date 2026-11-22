import type { Email } from '../../domain/Email';
import type { User } from '../../domain/User';

/** Port de iesire pentru persistenta utilizatorilor. */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /** Insereaza un utilizator nou; arunca `ConflictError` (EMAIL_TAKEN) daca emailul exista deja. */
  save(user: User): Promise<void>;
}
