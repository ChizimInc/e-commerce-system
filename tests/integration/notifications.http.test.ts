import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { openApiDocument } from '../../src/infrastructure/http/openapi';
import {
  notificationPageResponseSchema,
  preferencesResponseSchema,
} from '../../src/modules/notifications/adapters/http/notifications.schemas';
import { orderResponseSchema } from '../../src/modules/ordering/adapters/http/orders.schemas';
import { bearer, buildTestApp, type TestApp } from '../helpers/app';
import { ADDRESS_PROPS } from '../helpers/order-fixtures';

describe('Notificari (HTTP): fluxul comenzii, preferinte, istoric, izolare', () => {
  let ctx: TestApp;
  let admin: string;
  let ana: string;
  let bob: string;

  const as = (token: string) => ({
    get: (url: string) =>
      request(ctx.app)
        .get(url)
        .set(...bearer(token)),
    post: (url: string) =>
      request(ctx.app)
        .post(url)
        .set(...bearer(token)),
    patch: (url: string) =>
      request(ctx.app)
        .patch(url)
        .set(...bearer(token)),
    put: (url: string) =>
      request(ctx.app)
        .put(url)
        .set(...bearer(token)),
  });

  beforeEach(async () => {
    ctx = buildTestApp();
    admin = await ctx.adminToken();
    ana = await ctx.customerToken('ana@test.local');
    bob = await ctx.customerToken('bob@test.local');
  });

  const placeOrder = async (token = ana, amount = 20_000) => {
    const product = await as(admin)
      .post('/products')
      .send({ name: `Produs ${amount}`, price: { amount, currency: 'RON' }, stock: 50 });
    const productId = (product.body as { id: string }).id;
    expect(
      (await as(token).post('/cart/items').send({ itemId: productId, quantity: 1 })).status,
    ).toBe(200);
    const response = await as(token)
      .post('/orders')
      .send({ address: ADDRESS_PROPS, deliveryMethod: 'STANDARD', paymentMethod: 'CARD' });
    expect(response.status).toBe(201);
    return orderResponseSchema.parse(response.body);
  };

  const pay = (orderId: string, token = ana) => as(token).post(`/orders/${orderId}/payment`);
  const ship = (orderId: string) => as(admin).post(`/orders/${orderId}/shipment`);
  const setStatus = (orderId: string, status: string) =>
    as(admin).patch(`/orders/${orderId}/status`).send({ status });

  const history = async (token = ana, query = '') => {
    const response = await as(token).get(`/notifications${query}`);
    expect(response.status).toBe(200);
    return notificationPageResponseSchema.parse(response.body);
  };
  /** Titlurile notificarilor, de la cea mai veche la cea mai noua (ordinea in care s-au intamplat). */
  const timeline = async (token = ana) =>
    (await history(token)).items.map((n) => `${n.channel}:${n.subject}`).reverse();
  const setChannels = (channels: string[], token = ana) =>
    as(token).put('/notifications/preferences').send({ channels });

  describe('fluxul comenzii: comanda -> plata -> expediere -> livrare', () => {
    it('fiecare pas al comenzii produce o notificare EMAIL (canalul implicit), in ordine, cu textul potrivit', async () => {
      const order = await placeOrder();
      expect((await pay(order.id)).status).toBe(201);
      expect((await ship(order.id)).status).toBe(201);
      expect((await setStatus(order.id, 'DELIVERED')).status).toBe(200);

      expect(await timeline()).toEqual([
        'EMAIL:Comanda a fost plasata',
        'EMAIL:Plata a fost confirmata',
        'EMAIL:Comanda a fost expediata',
        'EMAIL:Comanda a fost livrata',
      ]);
      const page = await history();
      expect(page.total).toBe(4);
      for (const notification of page.items) {
        expect(notification).toMatchObject({ kind: 'ORDER_STATUS', orderId: order.id });
      }
      // textul contine suma de plata, dar nu datele personale
      const placed = page.items.at(-1);
      expect(placed?.body).toContain('Total de plata: 200.00 RON');
      expect(placed?.body).toContain(`#${order.id.slice(0, 8)}`);
    });

    it('notificarile nu contin adresa sau numele destinatarului (nici in istoric)', async () => {
      const order = await placeOrder();
      await pay(order.id);

      const all = JSON.stringify(await history());

      expect(all).not.toMatch(/Popescu|Libertatii|Chisinau|MD-2001/);
    });

    it('anulare dupa plata: anulata, apoi rambursata (in aceasta ordine), cu mesaj despre returnarea banilor', async () => {
      const order = await placeOrder();
      await pay(order.id);
      expect((await setStatus(order.id, 'CANCELLED')).status).toBe(200);

      expect(await timeline()).toEqual([
        'EMAIL:Comanda a fost plasata',
        'EMAIL:Plata a fost confirmata',
        'EMAIL:Comanda a fost anulata',
        'EMAIL:Banii au fost returnati',
      ]);
      const [refunded, cancelled] = (await history()).items;
      expect(cancelled?.body).toContain('suma ti se va returna');
      expect(refunded?.body).toContain('Am returnat 200.00 RON');
    });

    it('anulare inainte de plata: doar "anulata", fara rambursare', async () => {
      const order = await placeOrder();
      await setStatus(order.id, 'CANCELLED');

      expect(await timeline()).toEqual([
        'EMAIL:Comanda a fost plasata',
        'EMAIL:Comanda a fost anulata',
      ]);
      expect((await history()).items[0]?.body).toContain('Nu s-a incasat nicio suma');
    });

    it('o tranzitie respinsa (comanda neplatita nu se expediaza) nu produce notificare', async () => {
      const order = await placeOrder();
      expect((await ship(order.id)).status).toBe(409);

      expect(await timeline()).toEqual(['EMAIL:Comanda a fost plasata']);
    });
  });

  describe('preferinte', () => {
    it('implicit: doar EMAIL, marcat isDefault', async () => {
      const response = await as(ana).get('/notifications/preferences');

      expect(response.status).toBe(200);
      expect(preferencesResponseSchema.parse(response.body)).toEqual({
        channels: ['EMAIL'],
        isDefault: true,
      });
    });

    it('canalele alese se aplica notificarilor urmatoare: SMS + PUSH, fara EMAIL, fiecare formatat pe mediul lui', async () => {
      const saved = await setChannels(['PUSH', 'SMS']);
      expect(saved.status).toBe(200);
      expect(preferencesResponseSchema.parse(saved.body)).toEqual({
        channels: ['SMS', 'PUSH'],
        isDefault: false,
      });

      const order = await placeOrder();
      await pay(order.id);

      const items = (await history()).items;
      expect(items).toHaveLength(4); // 2 evenimente x 2 canale
      expect(new Set(items.map((n) => n.channel))).toEqual(new Set(['SMS', 'PUSH']));
      const sms = items.find((n) => n.channel === 'SMS');
      const push = items.find((n) => n.channel === 'PUSH');
      expect(sms?.subject).toBeNull();
      expect(sms?.body.length).toBeLessThanOrEqual(160);
      expect(push?.subject).toBeTruthy();
    });

    it('schimbarea preferintelor nu rescrie istoricul, doar notificarile viitoare', async () => {
      const order = await placeOrder(); // EMAIL implicit
      await setChannels(['PUSH']);
      await pay(order.id);

      expect(await timeline()).toEqual([
        'EMAIL:Comanda a fost plasata',
        'PUSH:Plata a fost confirmata',
      ]);
    });

    it('lista goala opreste notificarile', async () => {
      await setChannels([]);
      const order = await placeOrder();
      await pay(order.id);
      expect((await history()).total).toBe(0);
      expect(
        preferencesResponseSchema.parse((await as(ana).get('/notifications/preferences')).body),
      ).toEqual({ channels: [], isDefault: false });

      // ordinea cererii nu conteaza: raspunsul e in ordinea standard
      const reordered = await setChannels(['SMS', 'EMAIL']);
      expect((reordered.body as { channels: string[] }).channels).toEqual(['EMAIL', 'SMS']);
    });

    it('refuza canale necunoscute, campuri in plus, prea multe canale sau corp lipsa (400)', async () => {
      expect((await setChannels(['FAX'])).status).toBe(400);
      expect(
        (
          await as(ana)
            .put('/notifications/preferences')
            .send({ channels: ['EMAIL'], userId: 'x' })
        ).status,
      ).toBe(400);
      expect((await setChannels(['EMAIL', 'SMS', 'PUSH', 'EMAIL'])).status).toBe(400);
      // duplicatele sunt respinse (la fel indiferent de cate canale sunt)
      expect((await setChannels(['SMS', 'SMS'])).status).toBe(400);
      expect((await as(ana).put('/notifications/preferences').send({})).status).toBe(400);
    });

    it('preferintele unui client nu le schimba pe ale altuia', async () => {
      await setChannels([], ana);

      const forBob = await as(bob).get('/notifications/preferences');

      expect(forBob.body).toEqual({ channels: ['EMAIL'], isDefault: true });
    });
  });

  describe('istoric, izolare si securitate', () => {
    it('fiecare client vede doar notificarile lui', async () => {
      const anaOrder = await placeOrder(ana);
      await placeOrder(bob, 5_000);
      await pay(anaOrder.id);

      expect((await history(ana)).total).toBe(2);
      const forBob = await history(bob);
      expect(forBob.total).toBe(1);
      expect(forBob.items[0]?.orderId).not.toBe(anaOrder.id);
    });

    it('ruta nu accepta un id de utilizator din cerere: identitatea vine din token', async () => {
      await placeOrder(ana);
      const response = await as(bob).get(`/notifications?userId=${ana}&recipientId=${ana}`);

      expect(notificationPageResponseSchema.parse(response.body).total).toBe(0);
    });

    it('pagineaza (limit/offset), cele mai noi primele, si valideaza parametrii', async () => {
      const order = await placeOrder();
      await pay(order.id);
      await ship(order.id);

      const first = await history(ana, '?limit=2');
      const second = await history(ana, '?limit=2&offset=2');

      expect(first.items.map((n) => n.subject)).toEqual([
        'Comanda a fost expediata',
        'Plata a fost confirmata',
      ]);
      expect(second.items.map((n) => n.subject)).toEqual(['Comanda a fost plasata']);
      expect([first.total, first.limit, second.offset]).toEqual([3, 2, 2]);
      expect((await as(ana).get('/notifications?limit=0')).status).toBe(400);
      expect((await as(ana).get('/notifications?limit=101')).status).toBe(400);
      expect((await as(ana).get('/notifications?offset=-1')).status).toBe(400);
    });

    it('toate rutele cer autentificare (401)', async () => {
      for (const [method, url] of [
        ['get', '/notifications'],
        ['get', '/notifications/preferences'],
        ['put', '/notifications/preferences'],
      ] as const) {
        expect((await request(ctx.app)[method](url)).status, `${method} ${url}`).toBe(401);
      }
    });
  });

  describe('erorile de notificare nu afecteaza comanda', () => {
    it('outbox cazut: comanda se plaseaza, se plateste, se expediaza si se anuleaza normal; nu apar notificari', async () => {
      ctx.repositories.notificationOutbox.append = () =>
        Promise.reject(new Error('outbox indisponibil'));

      const order = await placeOrder();
      expect((await pay(order.id)).status).toBe(201);
      expect((await ship(order.id)).status).toBe(201);
      const delivered = await setStatus(order.id, 'DELIVERED');

      expect(delivered.status).toBe(200);
      expect(orderResponseSchema.parse(delivered.body).status).toBe('DELIVERED');
      expect((await history()).total).toBe(0);
    });

    it('preferinte ilizibile: comanda merge mai departe', async () => {
      ctx.repositories.notificationPreferences.find = () =>
        Promise.reject(new Error('baza indisponibila'));

      const order = await placeOrder();

      expect((await pay(order.id)).status).toBe(201);
    });
  });

  describe('documentatie OpenAPI', () => {
    it('expune rutele de notificari si schemele lor', () => {
      const paths = Object.keys((openApiDocument as { paths: object }).paths);
      expect(paths).toEqual(
        expect.arrayContaining(['/notifications', '/notifications/preferences']),
      );
      const schemas = Object.keys(
        (openApiDocument as { components: { schemas: object } }).components.schemas,
      );
      expect(schemas).toEqual(
        expect.arrayContaining(['NotificationPage', 'NotificationPreferences']),
      );
    });
  });
});
