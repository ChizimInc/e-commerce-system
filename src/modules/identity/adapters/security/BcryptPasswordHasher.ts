import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../ports/out/PasswordHasher';

/** Adaptor bcrypt (implementare pur JavaScript: fara compilare nativa, acelasi format de hash). */
export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 10) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
