import { z } from 'zod';

export type JsonObject = Record<string, unknown>;

/** O bucata de document OpenAPI pe care un modul o adauga la documentul global. */
export interface OpenApiFragment {
  readonly tags?: readonly { name: string; description: string }[];
  readonly paths: Record<string, JsonObject>;
  readonly schemas?: Record<string, JsonObject>;
}

/** Schema JSON (OpenAPI 3.0) derivata dintr-o schema Zod: documentatia nu poate diverge de validare. */
export function schemaOf(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io });
}

/** Corp JSON; `example` este exemplul afisat in Swagger UI (altfel ar folosi valorile maxime din scheme). */
export function jsonBody(schema: z.ZodType, example?: unknown): JsonObject {
  return {
    required: true,
    content: {
      'application/json': {
        schema: schemaOf(schema, 'input'),
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

export function jsonResponse(description: string, schema: JsonObject): JsonObject {
  return { description, content: { 'application/json': { schema } } };
}

export const ref = (name: string): JsonObject => ({ $ref: `#/components/schemas/${name}` });

export function errorResponse(description: string): JsonObject {
  return jsonResponse(description, ref('Error'));
}

export const bearerSecurity = [{ bearerAuth: [] }];

export function idPathParam(description: string): JsonObject {
  return {
    name: 'id',
    in: 'path',
    required: true,
    description,
    schema: { type: 'string', format: 'uuid' },
  };
}

/** Parametrii de query (OpenAPI) dintr-o schema Zod de tip obiect. */
export function queryParameters(schema: z.ZodType): JsonObject[] {
  const json = schemaOf(schema, 'input');
  const properties = (json['properties'] ?? {}) as Record<string, JsonObject>;
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property,
  }));
}
