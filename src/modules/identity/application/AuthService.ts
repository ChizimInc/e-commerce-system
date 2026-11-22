import {
  ConflictError,
  DomainError,
  NotFoundError,
  UnauthorizedError,
  type IdGenerator,
  type Logger,
  type Role,
} from '../../../shared';
import { Email } from '../domain/Email';
import { assertValidPassword } from '../domain/Password';
import { User } from '../domain/User';
import type { AuthUseCases, Credentials, LoginResult } from '../ports/in/AuthUseCases';
import type { PasswordHasher } from '../ports/out/PasswordHasher';
import type { TokenService } from '../ports/out/TokenService';
import type { UserRepository } from '../ports/out/UserRepository';

const INVALID_CREDENTIALS = 'Email sau parola incorecte';

/** Cazurile de utilizare de identitate: inregistrare, login (bcrypt + JWT), profil. */
export class AuthService implements AuthUseCases {
  /** Hash fals, folosit ca sa cheltuim acelasi timp de calcul cand emailul nu exista. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  async register(credentials: Credentials, role: Role = 'CUSTOMER'): Promise<User> {
    const email = Email.of(credentials.email);
    assertValidPassword(credentials.password);
    if (await this.users.findByEmail(email)) {
      throw new ConflictError('Exista deja un cont cu acest email', 'EMAIL_TAKEN');
    }
    const user = new User({
      id: this.ids.next(),
      email,
      passwordHash: await this.hasher.hash(credentials.password),
      role,
      createdAt: new Date(),
    });
    // Daca doua cereri concurente trec de verificarea de mai sus, unicitatea e garantata de repository.
    await this.users.save(user);
    this.logger.info('Utilizator inregistrat', { userId: user.id, role });
    return user;
  }

  async login(credentials: Credentials): Promise<LoginResult> {
    const user = await this.findUserForLogin(credentials.email);
    // Verificam parola si cand utilizatorul nu exista (hash fals), ca timpul de raspuns sa nu
    // dezvaluie care emailuri au cont.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await this.hasher.verify(credentials.password, hash);
    if (!user || !passwordMatches) {
      this.logger.warn('Login esuat');
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }
    const { token, expiresInSeconds } = this.tokens.issue({ userId: user.id, role: user.role });
    this.logger.info('Login reusit', { userId: user.id });
    return { accessToken: token, expiresInSeconds, user };
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Utilizator', userId);
    return user;
  }

  private async findUserForLogin(rawEmail: string): Promise<User | null> {
    try {
      return await this.users.findByEmail(Email.of(rawEmail));
    } catch (error) {
      // Un email cu forma invalida nu poate avea cont (acelasi raspuns ca la parola gresita);
      // orice alta eroare (ex. baza de date indisponibila) trebuie sa ajunga la handlerul central.
      if (error instanceof DomainError) return null;
      throw error;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('parola-fictiva-pentru-timp-constant');
    return this.dummyHash;
  }
}
