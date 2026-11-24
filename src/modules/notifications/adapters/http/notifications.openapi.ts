import {
  bearerSecurity,
  errorResponse,
  jsonBody,
  jsonResponse,
  queryParameters,
  ref,
  schemaOf,
  type OpenApiFragment,
} from '../../../../infrastructure/http/openapi-helpers';
import {
  listNotificationsQuerySchema,
  notificationPageResponseSchema,
  preferencesResponseSchema,
  setPreferencesSchema,
} from './notifications.schemas';

const unauthorized = errorResponse('Lipseste tokenul sau este invalid (UNAUTHORIZED)');
const invalid = errorResponse('Date de intrare invalide (VALIDATION_ERROR)');

export const notificationsOpenApi: OpenApiFragment = {
  tags: [
    {
      name: 'Notifications',
      description:
        'Notificari la schimbarea starii comenzii (plasata, platita, expediata, livrata, anulata, rambursata) pe canalele alese de client (EMAIL, SMS, PUSH). ' +
        'Canalele sunt SIMULATE: scriu in istoricul de mai jos (outbox) si in log, fara date personale; nu pleaca nimic real. Implicit, un client primeste doar EMAIL. ' +
        'O eroare de notificare nu afecteaza comanda.',
    },
  ],
  schemas: {
    NotificationPage: schemaOf(notificationPageResponseSchema),
    NotificationPreferences: schemaOf(preferencesResponseSchema),
  },
  paths: {
    '/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Istoricul notificarilor mele (cele mai noi primele)',
        description: 'Fiecare client vede doar notificarile lui; identitatea vine din token.',
        security: bearerSecurity,
        parameters: queryParameters(listNotificationsQuerySchema),
        responses: {
          '200': jsonResponse('Pagina de notificari', ref('NotificationPage')),
          '400': invalid,
          '401': unauthorized,
        },
      },
    },
    '/notifications/preferences': {
      get: {
        tags: ['Notifications'],
        summary: 'Canalele mele de notificare',
        security: bearerSecurity,
        responses: {
          '200': jsonResponse(
            'Canalele alese (sau cele implicite)',
            ref('NotificationPreferences'),
          ),
          '401': unauthorized,
        },
      },
      put: {
        tags: ['Notifications'],
        summary: 'Seteaza canalele mele de notificare',
        description:
          'Inlocuieste lista de canale (fara duplicate; lista goala = nicio notificare). Se aplica notificarilor viitoare.',
        security: bearerSecurity,
        requestBody: jsonBody(setPreferencesSchema, { channels: ['EMAIL', 'PUSH'] }),
        responses: {
          '200': jsonResponse('Canalele salvate', ref('NotificationPreferences')),
          '400': invalid,
          '401': unauthorized,
        },
      },
    },
  },
};
