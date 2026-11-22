/** Port de iesire: hash-uirea si verificarea parolelor (adaptor: bcrypt). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
