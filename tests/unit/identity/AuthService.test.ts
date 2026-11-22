import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, DomainError, NotFoundError, UnauthorizedError } from '../../../src/shared';
import { InMemoryUserRepository } from '../../../src/modules/identity/adapters/persistence/InMemoryUserRepository';
import { BcryptPasswordHasher } from '../../../src/modules/identity/adapters/security/BcryptPasswordHasher';
import { JwtTokenService } from '../../../src/modules/identity/adapters/security/JwtTokenService';
import { AuthService } from '../../../src/modules/identity/application/AuthService';
import { BootstrapAdmin } from '../../../src/modules/identity/application/BootstrapAdmin';
import { Email } from '../../../src/modules/identity/domain/Email';
import type { PasswordHasher } from '../../../src/modules/identity/ports/out/PasswordHasher';
import { SequentialIdGenerator } from '../../helpers/ids';
import { silentLogger } from '../../helpers/silent-logger';

/** Hasher real (bcrypt cost 4) care numara verificarile, ca sa putem testa timpul constant. */
class SpyHasher implements PasswordHasher {
  verifyCalls = 0;
  private readonly real = new BcryptPasswordHasher(4);
  hash(plain: string): Promise<string> {
    return this.real.hash(plain);
  }
  verify(plain: string, hash: string): Promise<boolean> {
    this.verifyCalls++;
    return this.real.verify(plain, hash);
  }
}

function setup() {
  const users = new InMemoryUserRepository();
  const hasher = new SpyHasher();
  const tokens = new JwtTokenService('s'.repeat(40), 3600);
  const ids = new SequentialIdGenerator();
  const auth = new AuthService(users, hasher, tokens, ids, silentLogger);
  return { users, hasher, tokens, ids, auth };
}

const credentials = { email: 'ana@example.com', password: 'parola-lunga-123' };

describe('AuthService.register', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creeaza un CUSTOMER cu parola hash-uita (niciodata in clar)', async () => {
    const user = await ctx.auth.register(credentials);
    expect(user.role).toBe('CUSTOMER');
    expect(user.email.value).toBe('ana@example.com');
    expect(user.passwordHash).not.toContain(credentials.password);
    expect(await new BcryptPasswordHasher(4).verify(credentials.password, user.passwordHash)).toBe(
      true,
    );
  });

  it('normalizeaza emailul, deci acelasi email cu litere mari e considerat duplicat', async () => {
    await ctx.auth.register(credentials);
    await expect(
      ctx.auth.register({ ...credentials, email: '  ANA@Example.com ' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('refuza email invalid si parola slaba', async () => {
    await expect(ctx.auth.register({ ...credentials, email: 'nu-e-email' })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(ctx.auth.register({ ...credentials, password: 'scurta' })).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
  });

  it('o a doua inregistrare concurenta cu acelasi email esueaza cu ConflictError', async () => {
    const results = await Promise.allSettled([
      ctx.auth.register(credentials),
      ctx.auth.register(credentials),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError);
  });

  it('permite rolul ADMIN doar cand e cerut explicit de cod (nu din API-ul public)', async () => {
    const admin = await ctx.auth.register(credentials, 'ADMIN');
    expect(admin.isAdmin()).toBe(true);
  });
});

describe('AuthService.login', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.auth.register(credentials);
  });

  it('intoarce un JWT valid pentru credentiale corecte', async () => {
    const result = await ctx.auth.login(credentials);
    expect(result.expiresInSeconds).toBe(3600);
    expect(ctx.tokens.verify(result.accessToken)).toEqual({
      userId: result.user.id,
      role: 'CUSTOMER',
    });
  });

  it('accepta emailul cu alte litere mari/mici', async () => {
    await expect(
      ctx.auth.login({ ...credentials, email: 'ANA@example.com' }),
    ).resolves.toBeDefined();
  });

  it('parola gresita si emailul necunoscut dau exact aceeasi eroare', async () => {
    const wrongPassword = await ctx.auth
      .login({ ...credentials, password: 'gresita-gresita' })
      .catch((e: unknown) => e);
    const unknownEmail = await ctx.auth
      .login({ email: 'nimeni@example.com', password: 'orice-parola' })
      .catch((e: unknown) => e);
    expect(wrongPassword).toBeInstanceOf(UnauthorizedError);
    expect(unknownEmail).toBeInstanceOf(UnauthorizedError);
    expect((wrongPassword as Error).message).toBe((unknownEmail as Error).message);
  });

  it('verifica parola chiar si cand emailul nu exista (cost de calcul constant, fara enumerare)', async () => {
    const before = ctx.hasher.verifyCalls;
    await ctx.auth
      .login({ email: 'nimeni@example.com', password: 'orice-parola' })
      .catch(() => undefined);
    expect(ctx.hasher.verifyCalls).toBe(before + 1);
  });

  it('un email cu forma invalida da tot 401 (nu 422), ca sa nu dezvaluie nimic', async () => {
    await expect(ctx.auth.login({ email: 'nu-e-email', password: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('AuthService.getProfile', () => {
  it('intoarce utilizatorul sau NotFound', async () => {
    const { auth } = setup();
    const user = await auth.register(credentials);
    expect((await auth.getProfile(user.id)).email.value).toBe('ana@example.com');
    await expect(auth.getProfile('00000000-0000-4000-8000-0000000000ff')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('AuthService.login: erori de infrastructura', () => {
  it('o eroare a repository-ului nu se transforma in 401: ajunge la apelant', async () => {
    const users = new InMemoryUserRepository();
    const broken = Object.assign(users, {
      findByEmail: () => Promise.reject(new Error('conexiune pierduta')),
    });
    const auth = new AuthService(
      broken,
      new SpyHasher(),
      new JwtTokenService('s'.repeat(40), 3600),
      new SequentialIdGenerator(),
      silentLogger,
    );
    await expect(auth.login(credentials)).rejects.toThrow('conexiune pierduta');
  });
});

describe('BootstrapAdmin', () => {
  it('refuza (nu pretinde ca a reusit) cand emailul adminului e deja un CUSTOMER', async () => {
    const users = new InMemoryUserRepository();
    const hasher = new BcryptPasswordHasher(4);
    const ids = new SequentialIdGenerator();
    const tokens = new JwtTokenService('s'.repeat(40), 3600);
    await new AuthService(users, hasher, tokens, ids, silentLogger).register({
      email: 'admin@example.com',
      password: 'parola-atacator-1',
    });
    await expect(
      new BootstrapAdmin(users, hasher, ids).execute('admin@example.com', 'parola-admin-1'),
    ).rejects.toMatchObject({ code: 'ADMIN_EMAIL_TAKEN' });
  });

  it('creeaza un ADMIN, este idempotent si valideaza parola', async () => {
    const users = new InMemoryUserRepository();
    const bootstrap = new BootstrapAdmin(
      users,
      new BcryptPasswordHasher(4),
      new SequentialIdGenerator(),
    );
    expect(await bootstrap.execute('Admin@Example.com', 'parola-admin-1')).toBe('created');
    expect(await bootstrap.execute('admin@example.com', 'alta-parola-2')).toBe('exists');
    const admin = await users.findByEmail(Email.of('admin@example.com'));
    expect(admin?.role).toBe('ADMIN');
    await expect(bootstrap.execute('alt@example.com', 'scurta')).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
  });
});
