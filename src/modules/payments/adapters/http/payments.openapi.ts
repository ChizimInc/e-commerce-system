import {
  bearerSecurity,
  errorResponse,
  idPathParam,
  jsonResponse,
  ref,
  schemaOf,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import { paymentResponseSchema, webhookResponseSchema } from './payments.schemas';

const unauthorized = errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)');
const invalid = errorResponse('Date de intrare invalide (VALIDATION_ERROR)');

export const paymentsOpenApi: OpenApiFragment = {
  tags: [
    {
      name: 'Payments',
      description:
        'Plati. Furnizorul se alege dupa metoda de plata a comenzii (CARD -> Stripe, PAYPAL -> PayPal, CASH_ON_DELIVERY -> ramburs); toti sunt MOCK-uri locale, fara retea. ' +
        'Sume speciale pentru demo (in totalul comenzii): 666.01 = card refuzat, 666.02 = eroare furnizor, 666.03 = timeout, 666.04 = rambursare esuata.',
    },
  ],
  schemas: {
    Payment: schemaOf(paymentResponseSchema),
    WebhookResult: schemaOf(webhookResponseSchema),
  },
  paths: {
    '/orders/{id}/payment': {
      post: {
        tags: ['Payments'],
        summary: 'Plateste o comanda (doar proprietarul)',
        description:
          'Plateste comanda NEW prin furnizorul metodei ei de plata (validare -> autorizare -> captare -> inregistrare), apoi o trece in PAID si emite OrderPaid. ' +
          'O comanda nu se plateste de doua ori, nici la cereri simultane (cheie de idempotenta unica pe comanda): a doua cerere primeste 409. ' +
          'O plata refuzata sau esuata poate fi reluata. Daca anularea comenzii se intampla in timpul platii, suma incasata se returneaza imediat.',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        responses: {
          '201': jsonResponse('Plata incasata; comanda este PAID', ref('Payment')),
          '400': invalid,
          '401': unauthorized,
          '404': errorResponse('Comanda nu exista sau nu este a ta'),
          '409': errorResponse(
            'Comanda e deja platita (ORDER_ALREADY_PAID), anulata (ORDER_NOT_PAYABLE) sau plata e in curs (PAYMENT_IN_PROGRESS)',
          ),
          '422': errorResponse(
            'Card refuzat (PAYMENT_DECLINED) sau suma peste limita furnizorului (AMOUNT_ABOVE_PROVIDER_LIMIT)',
          ),
          '502': errorResponse('Eroare la furnizorul de plata (PAYMENT_PROVIDER_ERROR)'),
          '504': errorResponse('Furnizorul de plata nu a raspuns (PAYMENT_PROVIDER_TIMEOUT)'),
        },
      },
      get: {
        tags: ['Payments'],
        summary: 'Starea platii unei comenzi',
        description: 'O vede proprietarul comenzii sau ADMIN.',
        security: bearerSecurity,
        parameters: [idPathParam('Id-ul comenzii')],
        responses: {
          '200': jsonResponse('Plata comenzii', ref('Payment')),
          '400': invalid,
          '401': unauthorized,
          '404': errorResponse('Comanda nu exista, nu este a ta sau nu are plata'),
        },
      },
    },
    '/payments/webhooks/{provider}': {
      post: {
        tags: ['Payments'],
        summary: 'Webhook de la furnizorul de plata (autentificat prin semnatura)',
        description:
          'Nu cere token: mesajul e autentificat prin semnatura HMAC-SHA256 a corpului, verificata de verificatorul furnizorului. ' +
          'Stripe: antetul `Stripe-Signature: t=<secunde>,v1=<hex HMAC("t.corp")>`; PayPal: antetele `paypal-transmission-id`, `paypal-transmission-time` si `paypal-transmission-sig` (base64 HMAC "id|moment|corp"); ' +
          'ramburs (cod): antetul `X-Courier-Signature` (hex HMAC corp). Webhook-ul doar se reconciliaza cu plata noastra (nu schimba starea ei) si e idempotent.',
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            description: 'Furnizorul care trimite webhook-ul',
            schema: { type: 'string', enum: ['stripe', 'paypal', 'cod'] },
          },
        ],
        requestBody: {
          required: true,
          description: 'Evenimentul in formatul furnizorului (JSON)',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': jsonResponse('Webhook primit', ref('WebhookResult')),
          '400': invalid,
          '403': errorResponse(
            'Semnatura lipseste, e gresita sau mesajul e prea vechi (INVALID_WEBHOOK_SIGNATURE)',
          ),
          '422': errorResponse(
            'Corp semnat corect, dar fara formatul furnizorului (INVALID_WEBHOOK_PAYLOAD)',
          ),
        },
      },
    },
  },
};
