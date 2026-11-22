import jwt from 'jsonwebtoken';
import { ROLES, type Principal } from '../../../../shared';
import type { IssuedToken, TokenService } from '../../ports/out/TokenService';

const ALGORITHM = 'HS256';
const ISSUER = 'e-commerce-system';

/** Adaptor JWT (HS256). Algoritmul este fixat la verificare, deci tokenurile `alg: none` sunt respinse. */
export class JwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresInSeconds: number,
  ) {}

  issue(principal: Principal): IssuedToken {
    const token = jwt.sign({ role: principal.role }, this.secret, {
      algorithm: ALGORITHM,
      subject: principal.userId,
      issuer: ISSUER,
      expiresIn: this.expiresInSeconds,
    });
    return { token, expiresInSeconds: this.expiresInSeconds };
  }

  verify(token: string): Principal | null {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: [ALGORITHM], issuer: ISSUER });
      if (typeof payload === 'string') return null;
      const { sub, role } = payload;
      if (typeof sub !== 'string' || !(ROLES as readonly unknown[]).includes(role)) return null;
      return { userId: sub, role: role as Principal['role'] };
    } catch {
      return null; // semnatura gresita, expirat, malformat etc.
    }
  }
}
