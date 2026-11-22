import {
  bearerSecurity,
  errorResponse,
  jsonBody,
  jsonResponse,
  ref,
  schemaOf,
  type JsonObject,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import { addCartItemSchema, cartResponseSchema, updateCartItemSchema } from './cart.schemas';

const itemIdParam: JsonObject = {
  name: 'itemId',
  in: 'path',
  required: true,
  description: 'Id-ul produsului sau pachetului din cos',
  schema: { type: 'string', format: 'uuid' },
};

const common = {
  '400': errorResponse('Date de intrare invalide (VALIDATION_ERROR)'),
  '401': errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)'),
};

export const cartOpenApi: OpenApiFragment = {
  tags: [{ name: 'Cart', description: 'Cosul de cumparaturi al utilizatorului autentificat' }],
  schemas: { Cart: schemaOf(cartResponseSchema) },
  paths: {
    '/cart': {
      get: {
        tags: ['Cart'],
        summary: 'Cosul curent, cu total calculat',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Cosul', ref('Cart')), '401': common['401'] },
      },
      delete: {
        tags: ['Cart'],
        summary: 'Goleste cosul',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Cosul gol', ref('Cart')), '401': common['401'] },
      },
    },
    '/cart/items': {
      post: {
        tags: ['Cart'],
        summary: 'Adauga un produs sau un pachet (aduna cantitatea daca exista deja)',
        description: 'Valideaza existenta in catalog si stocul disponibil.',
        security: bearerSecurity,
        requestBody: jsonBody(addCartItemSchema, { itemId: '<id produs sau pachet>', quantity: 2 }),
        responses: {
          '200': jsonResponse('Cosul actualizat', ref('Cart')),
          ...common,
          '404': errorResponse('Produsul/pachetul nu exista in catalog'),
          '409': errorResponse('Stoc insuficient (INSUFFICIENT_STOCK)'),
          '422': errorResponse('Regula incalcata (ex. monede diferite in cos, cos plin)'),
        },
      },
    },
    '/cart/items/{itemId}': {
      patch: {
        tags: ['Cart'],
        summary: 'Modifica cantitatea unui articol din cos',
        security: bearerSecurity,
        parameters: [itemIdParam],
        requestBody: jsonBody(updateCartItemSchema, { quantity: 3 }),
        responses: {
          '200': jsonResponse('Cosul actualizat', ref('Cart')),
          ...common,
          '404': errorResponse('Articolul nu e in cos sau nu mai exista in catalog'),
          '409': errorResponse('Stoc insuficient (INSUFFICIENT_STOCK)'),
        },
      },
      delete: {
        tags: ['Cart'],
        summary: 'Sterge un articol din cos',
        security: bearerSecurity,
        parameters: [itemIdParam],
        responses: {
          '200': jsonResponse('Cosul actualizat', ref('Cart')),
          ...common,
          '404': errorResponse('Articolul nu e in cos'),
        },
      },
    },
  },
};
