import type { Role } from '../../../shared';
import type { Email } from './Email';

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  /** Hash bcrypt; parola in clar nu se pastreaza nicaieri. */
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: Date;
}

export class User {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: Date;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.role = props.role;
    this.createdAt = props.createdAt;
  }

  isAdmin(): boolean {
    return this.role === 'ADMIN';
  }
}
