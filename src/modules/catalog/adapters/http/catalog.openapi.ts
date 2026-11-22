import {
  bearerSecurity,
  errorResponse,
  idPathParam,
  jsonBody,
  jsonResponse,
  queryParameters,
  ref,
  schemaOf,
  type JsonObject,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import {
  bundleResponseSchema,
  categoryResponseSchema,
  createBundleSchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  productPageResponseSchema,
  productResponseSchema,
  updateBundleSchema,
  updateCategorySchema,
  updateProductSchema,
} from './catalog.schemas';

const notFound = errorResponse('Resursa nu exista');
const invalid = errorResponse('Date de intrare invalide (VALIDATION_ERROR)');
const unauthorized = errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)');
const forbidden = errorResponse('Rolul ADMIN este necesar (FORBIDDEN)');
const conflict = errorResponse(
  'Conflict cu starea curenta (ex. categorie nevida, produs in pachet)',
);

const adminResponses = { '400': invalid, '401': unauthorized, '403': forbidden };

function admin(operation: JsonObject): JsonObject {
  return { ...operation, security: bearerSecurity };
}

const categoryNodeSchema: JsonObject = {
  type: 'object',
  required: ['id', 'name', 'parentId', 'children'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    parentId: { type: 'string', format: 'uuid', nullable: true },
    children: { type: 'array', items: ref('CategoryNode') },
  },
};

export const catalogOpenApi: OpenApiFragment = {
  tags: [
    { name: 'Catalog', description: 'Produse, categorii si pachete: citire publica' },
    {
      name: 'Catalog (admin)',
      description: 'CRUD pentru produse, categorii si pachete (rol ADMIN)',
    },
  ],
  schemas: {
    Product: schemaOf(productResponseSchema),
    ProductPage: schemaOf(productPageResponseSchema),
    Category: schemaOf(categoryResponseSchema),
    CategoryNode: categoryNodeSchema,
    Bundle: schemaOf(bundleResponseSchema),
  },
  paths: {
    '/products': {
      get: {
        tags: ['Catalog'],
        summary: 'Listare, cautare si filtrare produse',
        description:
          'Cautarea (`q`) ignora diferenta intre litere mari si mici si se aplica numelui si descrierii. ' +
          'Filtrul `categoryId` include si subcategoriile. Rezultatele sunt sortate dupa nume.',
        parameters: queryParameters(listProductsQuerySchema),
        responses: {
          '200': jsonResponse('Pagina de produse', ref('ProductPage')),
          '400': invalid,
          '404': errorResponse('Categoria din filtru nu exista'),
        },
      },
      post: admin({
        tags: ['Catalog (admin)'],
        summary: 'Creeaza un produs',
        requestBody: jsonBody(createProductSchema, {
          name: 'Laptop Pro 15',
          description: 'Ultrabook cu 16 GB RAM',
          price: { amount: 399900, currency: 'RON' },
          stock: 10,
          categoryId: null,
        }),
        responses: {
          '201': jsonResponse('Produs creat', ref('Product')),
          '404': notFound,
          ...adminResponses,
        },
      }),
    },
    '/products/{id}': {
      get: {
        tags: ['Catalog'],
        summary: 'Detalii produs',
        parameters: [idPathParam('Id-ul produsului')],
        responses: {
          '200': jsonResponse('Produsul', ref('Product')),
          '400': invalid,
          '404': notFound,
        },
      },
      patch: admin({
        tags: ['Catalog (admin)'],
        summary: 'Modifica un produs (inclusiv stocul)',
        parameters: [idPathParam('Id-ul produsului')],
        requestBody: jsonBody(updateProductSchema, { stock: 25 }),
        responses: {
          '200': jsonResponse('Produs actualizat', ref('Product')),
          '404': notFound,
          ...adminResponses,
        },
      }),
      delete: admin({
        tags: ['Catalog (admin)'],
        summary: 'Sterge un produs (blocat daca face parte dintr-un pachet)',
        parameters: [idPathParam('Id-ul produsului')],
        responses: {
          '204': { description: 'Sters' },
          '404': notFound,
          '409': conflict,
          ...adminResponses,
        },
      }),
    },
    '/categories': {
      get: {
        tags: ['Catalog'],
        summary: 'Arborele de categorii',
        responses: {
          '200': jsonResponse('Categoriile radacina, cu subcategoriile imbricate', {
            type: 'object',
            properties: { items: { type: 'array', items: ref('CategoryNode') } },
          }),
        },
      },
      post: admin({
        tags: ['Catalog (admin)'],
        summary: 'Creeaza o categorie (optional sub o categorie parinte)',
        requestBody: jsonBody(createCategorySchema, { name: 'Laptopuri', parentId: null }),
        responses: {
          '201': jsonResponse('Categorie creata', ref('Category')),
          '404': notFound,
          '409': conflict,
          ...adminResponses,
        },
      }),
    },
    '/categories/{id}': {
      patch: admin({
        tags: ['Catalog (admin)'],
        summary: 'Redenumeste sau muta o categorie (fara cicluri)',
        parameters: [idPathParam('Id-ul categoriei')],
        requestBody: jsonBody(updateCategorySchema, { name: 'Notebook-uri' }),
        responses: {
          '200': jsonResponse('Categorie actualizata', ref('Category')),
          '404': notFound,
          '409': conflict,
          ...adminResponses,
        },
      }),
      delete: admin({
        tags: ['Catalog (admin)'],
        summary: 'Sterge o categorie goala (fara subcategorii si fara produse)',
        parameters: [idPathParam('Id-ul categoriei')],
        responses: {
          '204': { description: 'Stearsa' },
          '404': notFound,
          '409': conflict,
          ...adminResponses,
        },
      }),
    },
    '/bundles': {
      get: {
        tags: ['Catalog'],
        summary: 'Listare pachete (pretul se calculeaza din componente)',
        responses: {
          '200': jsonResponse('Pachetele', {
            type: 'object',
            properties: { items: { type: 'array', items: ref('Bundle') } },
          }),
        },
      },
      post: admin({
        tags: ['Catalog (admin)'],
        summary: 'Creeaza un pachet din produse existente',
        requestBody: jsonBody(createBundleSchema, {
          name: 'Set birou',
          description: 'Mouse + tastatura',
          discountPercent: 10,
          items: [{ productId: '<id produs>', quantity: 1 }],
        }),
        responses: {
          '201': jsonResponse('Pachet creat', ref('Bundle')),
          '404': notFound,
          '422': errorResponse('Regula de business incalcata (ex. monede diferite)'),
          ...adminResponses,
        },
      }),
    },
    '/bundles/{id}': {
      get: {
        tags: ['Catalog'],
        summary: 'Detalii pachet',
        parameters: [idPathParam('Id-ul pachetului')],
        responses: {
          '200': jsonResponse('Pachetul', ref('Bundle')),
          '400': invalid,
          '404': notFound,
        },
      },
      patch: admin({
        tags: ['Catalog (admin)'],
        summary: 'Modifica un pachet',
        parameters: [idPathParam('Id-ul pachetului')],
        requestBody: jsonBody(updateBundleSchema, { discountPercent: 15 }),
        responses: {
          '200': jsonResponse('Pachet actualizat', ref('Bundle')),
          '404': notFound,
          ...adminResponses,
        },
      }),
      delete: admin({
        tags: ['Catalog (admin)'],
        summary: 'Sterge un pachet',
        parameters: [idPathParam('Id-ul pachetului')],
        responses: { '204': { description: 'Sters' }, '404': notFound, ...adminResponses },
      }),
    },
  },
};
