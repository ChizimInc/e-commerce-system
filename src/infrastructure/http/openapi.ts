import { cartOpenApi } from '../../modules/cart/adapters/http/cart.openapi';
import { catalogOpenApi } from '../../modules/catalog/adapters/http/catalog.openapi';
import { authOpenApi } from '../../modules/identity/adapters/http/auth.openapi';
import { ordersOpenApi } from '../../modules/ordering/adapters/http/orders.openapi';
import { paymentsOpenApi } from '../../modules/payments/adapters/http/payments.openapi';
import { errorResponseSchema } from './common-schemas';
import { schemaOf, type JsonObject, type OpenApiFragment } from './openapi-helpers';

const systemOpenApi: OpenApiFragment = {
  tags: [{ name: 'System', description: 'Starea aplicatiei' }],
  schemas: {
    Error: schemaOf(errorResponseSchema),
    Health: {
      type: 'object',
      required: ['status', 'checks', 'uptimeSeconds', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
        checks: {
          type: 'object',
          properties: { database: { type: 'string', enum: ['up', 'down'] } },
        },
        uptimeSeconds: { type: 'number' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Starea aplicatiei si a bazei de date',
        responses: {
          '200': {
            description: 'Aplicatia si baza de date functioneaza',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: {
                  status: 'ok',
                  checks: { database: 'up' },
                  uptimeSeconds: 12.3,
                  timestamp: '2026-01-01T12:00:00.000Z',
                },
              },
            },
          },
          '503': {
            description: 'Baza de date nu raspunde',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
  },
};

/** Fragmentele de documentatie ale modulelor; fiecare modul nou isi adauga aici fragmentul. */
const fragments: readonly OpenApiFragment[] = [
  systemOpenApi,
  authOpenApi,
  catalogOpenApi,
  cartOpenApi,
  ordersOpenApi,
  paymentsOpenApi,
];

function buildDocument(parts: readonly OpenApiFragment[]): JsonObject {
  const merge = <T>(pick: (fragment: OpenApiFragment) => Record<string, T> | undefined) =>
    Object.assign({}, ...parts.map((fragment) => pick(fragment) ?? {})) as Record<string, T>;
  return {
    openapi: '3.0.3',
    info: {
      title: 'E-commerce System API',
      version: '0.1.0',
      description:
        'Sistem de e-commerce cu arhitectura hexagonala (TPSS + ASS). ' +
        'Rutele protejate cer antetul `Authorization: Bearer <token>`.',
    },
    tags: parts.flatMap((fragment) => fragment.tags ?? []),
    paths: merge((fragment) => fragment.paths),
    components: {
      schemas: merge((fragment) => fragment.schemas),
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}

/** Documentul OpenAPI servit de Swagger UI la `/docs`. */
export const openApiDocument = buildDocument(fragments);
