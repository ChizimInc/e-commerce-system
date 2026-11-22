import type { Role } from '../../../../shared';
import type { User } from '../../domain/User';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly user: User;
}

/** Port de intrare: inregistrare, autentificare si profilul utilizatorului curent. */
export interface AuthUseCases {
  /** Creeaza un cont. Rolul implicit este CUSTOMER; endpoint-ul public nu permite alt rol. */
  register(credentials: Credentials, role?: Role): Promise<User>;
  /** Arunca `UnauthorizedError` cu acelasi mesaj indiferent daca emailul sau parola e gresita. */
  login(credentials: Credentials): Promise<LoginResult>;
  getProfile(userId: string): Promise<User>;
}
