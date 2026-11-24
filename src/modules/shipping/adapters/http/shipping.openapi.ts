import {
  bearerSecurity,
  errorResponse,
  idPathParam,
  jsonResponse,
  ref,
  schemaOf,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import { shipmentResponseSchema, shippingQuoteResponseSchema } from './shipping.schemas';

const unauthorized = errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)');
const invalid = errorResponse('Date de intrare invalide (VALIDATION_ERROR)');

export const shippingOpenApi: OpenApiFragment = {
  tags: [
    {
      name: 'Shipping',
      description:
        'Livrari. Costul se calculeaza dupa metoda de livrare (Strategy): STANDARD 15.00 (gratuit de la 300.00 valoare marfa), EXPRESS 30.00 + 2.00 per bucata dupa prima, STORE_PICKUP 0; ' +
        'se adauga dupa reducere, inainte de TVA, in totalul comenzii. Curierul se alege dupa metoda (STANDARD -> Posta, EXPRESS -> curierul rapid, STORE_PICKUP -> magazin); ambii curieri sunt MOCK-uri locale, fara retea. ' +
        'Situatii simulate (la preluarea coletului): cod postal 00000 sau valoare declarata 777.01 = adresa nelivrabila (422), 00001 / 777.02 = eroare curier (502), 00002 / 777.03 = timeout (504).',
    },
  ],
  schemas: {
    Shipment: schemaOf(shipmentResponseSchema),
    ShippingQuote: schemaOf(shippingQuoteResponseSchema),
  },
  paths: {
    '/shipping/quote': {
      get: {
        tags: ['Shipping'],
        summary: 'Costul livrarii pentru cosul curent, inainte de checkout',
        description:
          'Intoarce costul fiecarei metode de livrare pentru cosul clientului, calculat cu aceleasi strategii ca totalul comenzii (valoarea marfii e cea dinainte de reducere).',
        security: bearerSecurity,
        responses: {
          '200': jsonResponse('Costul pe fiecare metoda de livrare', ref('ShippingQuote')),
          '401': unauthorized,
          '422': errorResponse('Cosul este gol (CART_EMPTY)'),
        },
      },
    },
    '/orders/{id}/shipment': {
      post: {
        tags: ['Shipping'],
        summary: 'Expediaza o comanda platita (doar ADMIN)',
        description:
          'Preda comanda PAID curierului metodei ei de livrare, apoi o trece in SHIPPED (State) si emite OrderShipped. ' +
          'O comanda nu se expediaza de doua ori, nici la cereri simultane (livrarea e unica pe comanda): a doua cerere primeste 409. ' +
          'O expediere refuzata sau esuata la curier se salveaza FAILED si poate fi reluata.',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        responses: {
          '201': jsonResponse(
            'Coletul a fost preluat de curier; comanda este SHIPPED',
            ref('Shipment'),
          ),
          '400': invalid,
          '401': unauthorized,
          '403': errorResponse('Doar ADMIN poate expedia (FORBIDDEN)'),
          '404': errorResponse('Comanda nu exista'),
          '409': errorResponse(
            'Comanda e deja expediata (ORDER_ALREADY_SHIPPED), neplatita / anulata (ORDER_NOT_SHIPPABLE) sau expedierea e in curs (SHIPMENT_IN_PROGRESS)',
          ),
          '422': errorResponse('Curierul a refuzat coletul (SHIPMENT_REJECTED)'),
          '502': errorResponse('Eroare la curier (COURIER_ERROR)'),
          '504': errorResponse('Curierul nu a raspuns (COURIER_TIMEOUT)'),
        },
      },
      get: {
        tags: ['Shipping'],
        summary: 'Starea livrarii unei comenzi',
        description:
          'O vede proprietarul comenzii sau ADMIN. Cat timp coletul e la curier, starea se reimprospateaza din urmarirea lui (CREATED -> IN_TRANSIT -> DELIVERED); daca curierul nu raspunde, se intoarce ultima stare salvata.',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        responses: {
          '200': jsonResponse('Livrarea comenzii', ref('Shipment')),
          '400': invalid,
          '401': unauthorized,
          '404': errorResponse('Comanda nu exista, nu este a ta sau nu are livrare'),
        },
      },
    },
  },
};
