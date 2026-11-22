import { z } from 'zod';
import { ROLES } from '../../../../shared';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../domain/Password';

// ---- Cereri ----

export const registerSchema = z
  .object({
    email: z.email().max(254),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH)
      .refine((value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES, {
        message: `Parola poate avea cel mult ${MAX_PASSWORD_BYTES} de octeti`,
      })
      .describe(`Minim ${MIN_PASSWORD_LENGTH} caractere, maxim ${MAX_PASSWORD_BYTES} de octeti`),
  })
  .strict();

/** La login nu repetam politica parolelor: orice credentiale gresite primesc acelasi raspuns. */
export const loginSchema = z
  .object({
    email: z.string().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

// ---- Raspunsuri ----

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  createdAt: z.iso.datetime(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().describe('JWT, de trimis in antetul Authorization: Bearer <token>'),
  tokenType: z.literal('Bearer'),
  expiresIn: z.int().describe('Valabilitatea tokenului, in secunde').meta({ example: 3600 }),
  user: userResponseSchema,
});
