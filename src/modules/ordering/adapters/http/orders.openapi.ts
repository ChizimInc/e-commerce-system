import {
  bearerSecurity,
  errorResponse,
  idPathParam,
  jsonBody,
  jsonResponse,
  queryParameters,
  ref,
  schemaOf,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import {
  changeOrderStatusSchema,
  listOrdersQuerySchema,
  orderPageResponseSchema,
  orderResponseSchema,
  placeOrderSchema,
} from './orders.schemas';

const unauthorized = errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)');
const invalid = errorResponse('Date de intrare invalide (VALIDATION_ERROR)');

export const ordersOpenApi: OpenApiFragment = {
  tags: [
    {
      name: 'Orders',
      description:
        'Comenzi. Ciclul de viata: NEW -> PAID -> SHIPPED -> DELIVERED; NEW/PAID -> CANCELLED; PAID anulata -> REFUNDED',
    },
  ],
  schemas: { Order: schemaOf(orderResponseSchema), OrderPage: schemaOf(orderPageResponseSchema) },
  paths: {
    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Creeaza o comanda din cosul curent',
        description:
          'Copiaza preturile din catalog, aplica reducerea si TVA configurate (total = subtotal - reducere + TVA), scade stocul si goleste cosul, intr-o singura tranzactie. Inainte de plasare ruleaza lantul de validare: stoc, adresa (tara livrabila), limita de suma, verificare anti-frauda. Comanda porneste in starea NEW.',
        security: bearerSecurity,
        requestBody: jsonBody(placeOrderSchema, {
          address: {
            recipientName: 'Ana Popescu',
            street: 'Str. Libertatii 10',
            city: 'Chisinau',
            postalCode: 'MD-2001',
            country: 'MD',
          },
          deliveryMethod: 'STANDARD',
          paymentMethod: 'CARD',
        }),
        responses: {
          '201': jsonResponse('Comanda creata', ref('Order')),
          '400': invalid,
          '401': unauthorized,
          '404': errorResponse('Un articol din cos nu mai exista in catalog'),
          '409': errorResponse(
            'Stoc insuficient (INSUFFICIENT_STOCK) sau cosul s-a modificat intre timp (CART_CHANGED)',
          ),
          '422': errorResponse(
            'Cos gol, total prea mare, adresa invalida sau tara nelivrabila, limita de suma depasita, comanda suspecta (INVALID_ORDER / INVALID_ADDRESS / UNSUPPORTED_COUNTRY / AMOUNT_LIMIT_EXCEEDED / ORDER_FLAGGED / MONEY_CURRENCY_MISMATCH)',
          ),
          '429': errorResponse('Prea multe comenzi intr-un interval scurt (ORDER_RATE_LIMITED)'),
        },
      },
      get: {
        tags: ['Orders'],
        summary: 'Istoricul comenzilor mele (cele mai noi primele)',
        security: bearerSecurity,
        parameters: queryParameters(listOrdersQuerySchema),
        responses: {
          '200': jsonResponse('Pagina de comenzi', ref('OrderPage')),
          '400': invalid,
          '401': unauthorized,
        },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Detaliile unei comenzi',
        description: 'Clientul vede doar comenzile lui (altfel 404); ADMIN vede orice comanda.',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        responses: {
          '200': jsonResponse('Comanda', ref('Order')),
          '400': invalid,
          '401': unauthorized,
          '404': errorResponse('Comanda nu exista sau nu este a ta'),
        },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Schimba statusul unei comenzi (ADMIN)',
        description:
          'Tranzitii permise: NEW->PAID, NEW->CANCELLED, PAID->SHIPPED, PAID->CANCELLED, SHIPPED->DELIVERED, CANCELLED->REFUNDED (doar daca a fost platita). Orice alta tranzitie: 422 INVALID_ORDER_TRANSITION. Dupa salvare se emit evenimentele de domeniu; anularea repune stocul (o singura data pe comanda).',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        requestBody: jsonBody(changeOrderStatusSchema, { status: 'PAID' }),
        responses: {
          '200': jsonResponse('Comanda actualizata', ref('Order')),
          '400': invalid,
          '401': unauthorized,
          '403': errorResponse('Nu esti ADMIN (FORBIDDEN)'),
          '404': errorResponse('Comanda nu exista'),
          '409': errorResponse('Comanda a fost modificata simultan (ORDER_CHANGED)'),
          '422': errorResponse('Tranzitie invalida (INVALID_ORDER_TRANSITION)'),
        },
      },
    },
  },
};
