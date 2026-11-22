import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { z } from 'zod';
import { principalOf } from '../../../../infrastructure/http/authentication';
import type { User } from '../../domain/User';
import type { AuthUseCases } from '../../ports/in/AuthUseCases';
import {
  loginSchema,
  registerSchema,
  type loginResponseSchema,
  type userResponseSchema,
} from './auth.schemas';

export interface AuthRouterDependencies {
  readonly auth: AuthUseCases;
  /** Middleware care cere autentificare (folosit pentru `/auth/me`). */
  readonly requireAuth: RequestHandler;
  /** Limita de cereri per IP pe inregistrare/login (bcrypt consuma CPU, iar parolele se pot ghici). */
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
}

export function toUserResponse(user: User): z.infer<typeof userResponseSchema> {
  return {
    id: user.id,
    email: user.email.value,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Adaptor inbound REST pentru identitate: inregistrare, login, profil. */
export function createAuthRouter({
  auth,
  requireAuth,
  rateLimit: limits,
}: AuthRouterDependencies): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: limits.windowMs,
    limit: limits.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Prea multe incercari, reincearca mai tarziu',
        },
      });
    },
  });

  // Corpul nu poate contine `role`: schema este strict, deci conturile publice sunt mereu CUSTOMER.
  router.post('/auth/register', limiter, async (req, res) => {
    const user = await auth.register(registerSchema.parse(req.body));
    res.status(201).json(toUserResponse(user));
  });

  router.post('/auth/login', limiter, async (req, res) => {
    const result = await auth.login(loginSchema.parse(req.body));
    const body: z.infer<typeof loginResponseSchema> = {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: result.expiresInSeconds,
      user: toUserResponse(result.user),
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.get('/auth/me', requireAuth, async (req, res) => {
    res.json(toUserResponse(await auth.getProfile(principalOf(req).userId)));
  });

  return router;
}
