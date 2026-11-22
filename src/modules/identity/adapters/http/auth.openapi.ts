import {
  bearerSecurity,
  errorResponse,
  jsonBody,
  jsonResponse,
  ref,
  schemaOf,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import {
  loginResponseSchema,
  loginSchema,
  registerSchema,
  userResponseSchema,
} from './auth.schemas';

export const authOpenApi: OpenApiFragment = {
  tags: [{ name: 'Auth', description: 'Inregistrare si autentificare (JWT)' }],
  schemas: {
    User: schemaOf(userResponseSchema),
    LoginResponse: schemaOf(loginResponseSchema),
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Creeaza un cont CUSTOMER',
        description:
          'Parola este stocata hash-uita cu bcrypt. Rolul nu se alege la inregistrare: conturile ' +
          'ADMIN se creeaza doar prin scriptul de seed.',
        requestBody: jsonBody(registerSchema, {
          email: 'ana.popescu@example.com',
          password: 'parola-lunga-123',
        }),
        responses: {
          '201': jsonResponse('Contul creat', ref('User')),
          '400': errorResponse('Date de intrare invalide (VALIDATION_ERROR)'),
          '409': errorResponse('Emailul este deja folosit (EMAIL_TAKEN)'),
          '429': errorResponse('Prea multe cereri de la acelasi IP (TOO_MANY_REQUESTS)'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Autentificare: intoarce un JWT',
        description:
          'Foloseste `accessToken` prin butonul **Authorize** din Swagger UI sau in antetul ' +
          '`Authorization: Bearer <token>`.',
        requestBody: jsonBody(loginSchema, {
          email: 'ana.popescu@example.com',
          password: 'parola-lunga-123',
        }),
        responses: {
          '200': jsonResponse('Autentificat', ref('LoginResponse')),
          '400': errorResponse('Date de intrare invalide (VALIDATION_ERROR)'),
          '401': errorResponse('Email sau parola incorecte (UNAUTHORIZED)'),
          '429': errorResponse('Prea multe cereri de la acelasi IP (TOO_MANY_REQUESTS)'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Profilul utilizatorului autentificat',
        security: bearerSecurity,
        responses: {
          '200': jsonResponse('Utilizatorul curent', ref('User')),
          '401': errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)'),
        },
      },
    },
  },
};
