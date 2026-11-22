/**
 * Documentul OpenAPI servit de Swagger UI la `/docs`.
 * Momentan documenteaza doar `/health`; fiecare modul isi adauga rutele pe masura ce apar.
 */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'E-commerce System API',
    version: '0.1.0',
    description: 'Sistem de e-commerce cu arhitectura hexagonala (TPSS + ASS).',
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
  components: {
    schemas: {
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
  },
};
