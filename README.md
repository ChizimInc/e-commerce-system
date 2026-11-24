# E-commerce System

Sistem de e-commerce cu arhitectură hexagonală (Ports & Adapters) și extensibilitate pentru plăți, livrări și notificări. Proiect universitar TPSS + ASS.

**Stack:** Node.js 22+, TypeScript (strict), Express, PostgreSQL 16, Prisma 7, Zod, bcrypt + JWT, Vitest, Swagger UI.

## Cerințe

- [Node.js](https://nodejs.org/) 22 sau mai nou
- [Docker](https://www.docker.com/) cu Docker Compose (pentru PostgreSQL)

## Instalare

```bash
npm install
cp .env.example .env     # apoi setează JWT_SECRET (min. 32 de caractere) și SEED_ADMIN_PASSWORD
```

Generarea unui secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Baza de date

Pornește PostgreSQL (datele rămân într-un volum Docker persistent):

```bash
docker compose up -d
docker compose ps        # așteaptă statusul "healthy"
```

Generează clientul Prisma și aplică migrațiile:

```bash
npm run db:generate
npm run db:migrate       # dezvoltare: creează/aplică migrații (prisma migrate dev)
npm run db:deploy        # doar aplică migrațiile existente (prisma migrate deploy)
npm run db:seed          # creează contul de administrator din SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (idempotent)
```

## Rulare

```bash
npm run dev              # dezvoltare, cu reload automat
npm run build && npm start   # producție (din dist/)
```

- Health check: <http://localhost:3000/health> (verifică și conexiunea la baza de date)
- Documentație API (Swagger UI): <http://localhost:3000/docs>

### Autentificare (JWT) și roluri

1. `POST /auth/register` creează un cont **CUSTOMER** (rolul nu se poate alege; conturile **ADMIN** se creează doar prin `npm run db:seed`).
2. `POST /auth/login` întoarce `accessToken`; în Swagger UI îl pui în butonul **Authorize**, iar cu curl în antetul `Authorization: Bearer <token>`.
3. Operațiile de administrare ale catalogului cer rolul ADMIN: fără token răspund **401**, cu un CUSTOMER **403**.
4. `/auth/register` și `/auth/login` au o limită de cereri per IP (`AUTH_RATE_LIMIT_MAX` într-o fereastră de `AUTH_RATE_LIMIT_WINDOW_SECONDS`), peste care răspund **429**. În spatele unui reverse proxy, configurează `trust proxy` în Express, altfel toți clienții apar cu IP-ul proxy-ului.

### Endpoint-uri

| Zonă             | Rută                                                                                                                      | Acces                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Auth             | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                                                                 | public / public / autentificat                                          |
| Catalog (citire) | `GET /products?q=&categoryId=&limit=&offset=`, `GET /products/:id`, `GET /categories`, `GET /bundles`, `GET /bundles/:id` | public                                                                  |
| Catalog (admin)  | `POST/PATCH/DELETE /products`, `/categories`, `/bundles`                                                                  | ADMIN                                                                   |
| Coș              | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`, `DELETE /cart/items/:itemId`, `DELETE /cart`                | autentificat                                                            |
| Comenzi          | `POST /orders`, `GET /orders?limit=&offset=`, `GET /orders/:id`                                                           | autentificat (doar ale lui)                                             |
| Comenzi (admin)  | `PATCH /orders/:id/status`                                                                                                | ADMIN                                                                   |
| Plăți            | `POST /orders/:id/payment`, `GET /orders/:id/payment`                                                                     | autentificat (plata: doar proprietarul; starea: proprietarul sau ADMIN) |
| Webhook plăți    | `POST /payments/webhooks/:provider` (`stripe`, `paypal`, `cod`)                                                           | semnătură HMAC, fără token                                              |
| Livrări          | `GET /shipping/quote`, `GET /orders/:id/shipment`                                                                         | autentificat (starea: proprietarul sau ADMIN)                           |
| Livrări (admin)  | `POST /orders/:id/shipment`                                                                                               | ADMIN                                                                   |

Detalii, scheme și exemple: Swagger UI la `/docs`.

### Comenzi și ciclul de viață

`POST /orders` creează o comandă din coșul utilizatorului (corp: `address`, `deliveryMethod`, `paymentMethod`). Prețurile și numele se **copiază** în comandă la momentul creării; stocul se scade (pentru pachete, din componente), comanda se salvează și liniile comandate se scot din coș, **într-o singură tranzacție**. Clientul vede doar comenzile lui (comanda altcuiva răspunde **404**, ca una inexistentă); ADMIN poate vedea orice comandă.

Statusul se schimbă doar de ADMIN, prin `PATCH /orders/:id/status` cu `{ "status": "PAID" }` (expedierea prin curier se face prin `POST /orders/:id/shipment`, vezi [Livrări](#livrări)). Tranzițiile permise (State):

```
NEW ──► PAID ──► SHIPPED ──► DELIVERED
 │       │
 │       └──► CANCELLED ──► REFUNDED   (rambursare doar dacă a fost plătită)
 └──────────► CANCELLED
```

Orice altă tranziție răspunde **422** cu codul `INVALID_ORDER_TRANSITION`. Metoda de livrare (`STANDARD`, `EXPRESS`, `STORE_PICKUP`) alege costul livrării (intră în total) și curierul (vezi [Livrări](#livrări)); metoda de plată (`CARD`, `PAYPAL`, `CASH_ON_DELIVERY`) alege furnizorul de plată (vezi [Plăți](#plăți)).

### Preț, validare și evenimente

**Preț (Decorator).** La creare, comanda calculează `subtotal` (suma liniilor), `discount`, `shipping` (costul livrării), `vat` și `total = subtotal - discount + shipping + vat` și le păstrează toate (în cenți, cu `Money`). Prețurile din catalog sunt **fără TVA**; reducerea se aplică pe subtotal (cel mai mare prag atins), livrarea se adaugă după reducere, iar TVA se aplică pe subtotalul redus plus livrare (livrarea se taxează). Orice sumă care ar depăși limita `INTEGER` din baza de date (inclusiv costul livrării și totalul după TVA) este refuzată cu **422** `INVALID_ORDER`, nu cu 500.

**Validare înainte de plasare (Chain of Responsibility).** `StockValidator → AddressValidator → AmountLimitValidator → FraudCheckValidator`; prima verigă care refuză oprește comanda, fără nicio modificare de stoc, coș sau comandă:

| Verigă                 | Refuză când                                                               | Răspuns                                                |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `StockValidator`       | stocul disponibil nu acoperă o linie                                      | **409** `INSUFFICIENT_STOCK`                           |
| `AddressValidator`     | țara nu e în `SHIPPING_COUNTRIES`                                         | **422** `UNSUPPORTED_COUNTRY`                          |
| `AmountLimitValidator` | totalul depășește `MAX_ORDER_AMOUNT_CENTS`                                | **422** `AMOUNT_LIMIT_EXCEEDED`                        |
| `FraudCheckValidator`  | totalul depășește pragul suspect, sau prea multe comenzi într-o fereastră | **422** `ORDER_FLAGGED` / **429** `ORDER_RATE_LIMITED` |

Lanțul se asamblează în `composition-root.ts` (`chainOf(...)`): o verigă nouă se adaugă acolo, fără a modifica `OrderService`.

**Evenimente (Observer).** După ce o tranziție este salvată, `OrderService` publică pe `EventBus` (`shared/events`) `OrderPlaced`, `OrderPaid`, `OrderShipped`, `OrderDelivered`, `OrderCancelled` sau `OrderRefunded` (fiecare stare emite câte un eveniment). Evenimentele nu poartă adresa sau numele destinatarului. Abonații se înregistrează în composition root: un jurnal (`OrderEventLogger`, doar id comandă, total, număr de linii) și `RestockOnOrderCancelled`, care **repune stocul** unei comenzi anulate, inclusiv componentele pachetelor. Repunerea este idempotentă (tabela `order_stock_restorations`): aceeași anulare procesată de două ori repune stocul o singură dată. O eroare dintr-un abonat se loghează și nu oprește ceilalți abonați și nu afectează comanda. Un al treilea abonat, `RefundOnOrderCancelled` (modulul `payments`), **rambursează** plata unei comenzi platite și anulate.

### Plăți

`POST /orders/:id/payment` plătește o comanda `NEW` prin furnizorul ales de **metoda ei de plată**: `CARD` → Stripe, `PAYPAL` → PayPal, `CASH_ON_DELIVERY` → ramburs (curier). **Toți furnizorii sunt mock-uri locale** (fără apeluri de rețea) cu API-uri deliberat diferite; adaptoarele le aduc la același port `PaymentGateway`. Doar proprietarul comenzii poate plăti (comanda altcuiva răspunde **404**, nici ADMIN nu plătește în locul clientului). Suma plătită este totalul comenzii (după reducere și TVA), păstrat în cenți.

Fluxul (Template Method): `validate → authorize → capture → record`; apoi comanda trece în `PAID` (State) și se emite `OrderPaid`. Starea platii: `GET /orders/:id/payment` (`PENDING → CAPTURED → REFUNDING → REFUNDED`, sau `DECLINED` / `FAILED`; `AUTHORIZED` e doar stare intermediară, în memorie).

| Situație                                                                                | Răspuns                                                               | Plata                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| plătită                                                                                 | **201**                                                               | `CAPTURED`, comanda `PAID`                              |
| card refuzat                                                                            | **422** `PAYMENT_DECLINED`                                            | `DECLINED` (motiv, ex. `card_declined`); se poate relua |
| eroare la furnizor / timeout                                                            | **502** `PAYMENT_PROVIDER_ERROR` / **504** `PAYMENT_PROVIDER_TIMEOUT` | `FAILED`; se poate relua                                |
| sumă peste limita furnizorului (Stripe 999.999,99; PayPal 100.000,00; ramburs 5.000,00) | **422** `AMOUNT_ABOVE_PROVIDER_LIMIT`                                 | `FAILED`, furnizorul nu e apelat                        |
| comandă deja plătită / plată în curs                                                    | **409** `ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`                  | neschimbată                                             |
| comandă anulată înainte de plată                                                        | **409** `ORDER_NOT_PAYABLE`                                           | -                                                       |

**Fără dublă plată, nici la cereri simultane.** Tabela `payments` are `order_id` **unic** și o cheie de idempotență unică (`pay:<orderId>`): plata se _revendică_ inserând-o; doar cererea care a inserat-o ajunge la furnizor, celelalte primesc 409. Reluarea unei plăți `DECLINED`/`FAILED` este tot o revendicare atomică (`UPDATE … WHERE status = …`). Aceleași chei de idempotență se trimit și furnizorului. Dacă anularea comenzii se întâmplă _în timpul_ plății, suma încasată se returnează imediat; dacă decontarea comenzii (`PAID`) eșuează tranzitoriu, plata rămâne `CAPTURED` (nu se rambursează) și o nouă cerere de plată duce la capăt doar decontarea, fără o a doua încasare.

**Rambursare.** `RefundOnOrderCancelled` (Observer pe `OrderCancelled`): dacă comanda fusese plătită, rambursează prin procesorul de rambursări al furnizorului și duce comanda în `REFUNDED` (se emite `OrderRefunded`). Idempotent: rambursarea se revendică (`CAPTURED → REFUNDING`, cu concurență optimistă), deci aceeași anulare procesată de două ori sau simultan rambursează o singură dată; dacă furnizorul refuză, plata revine în `CAPTURED`. PayPal nu mai ramburseaza după 180 de zile.

**Sume speciale pentru demo și teste** (se aplică totalului comenzii; mock-urile le recunosc la autorizare): `666.01` = card refuzat, `666.02` = eroare furnizor, `666.03` = timeout, `666.04` = rambursare eșuată. Pentru un total exact, porniți aplicația cu `VAT_PERCENT=0` și `DISCOUNT_TIERS=` (gol).

**Webhook-uri.** `POST /payments/webhooks/{stripe|paypal|cod}` nu cere token: mesajul e autentificat prin semnătura HMAC-SHA256 a corpului (secretul `PAYMENT_WEBHOOK_SECRET`), verificată pe octeții primiți. Fiecare furnizor își semnează altfel mesajele (Stripe: `Stripe-Signature: t=<secunde>,v1=<hex HMAC("t.corp")>`; PayPal: `paypal-transmission-id/-time/-sig`, base64 HMAC de `id|moment|corp`; ramburs: `X-Courier-Signature`, hex HMAC al corpului), iar `WebhookVerifier`-ul din familia furnizorului le verifică și le normalizează. Semnătură greșită, lipsă sau prea veche → **403** `INVALID_WEBHOOK_SIGNATURE`. Webhook-ul doar se _reconciliază_ cu plata (răspuns `{received, matched, paymentStatus}`) și nu modifică starea ei. Exemplu (ramburs, într-un terminal bash cu `openssl`):

```bash
BODY='{"eventId":"e1","kind":"CASH_COLLECTED","ticket":"COD-T00001"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3000/payments/webhooks/cod -H 'Content-Type: application/json' -H "X-Courier-Signature: $SIG" -d "$BODY"
```

### Livrări

**Cost (Strategy).** Costul livrării se alege la runtime după metoda de livrare a comenzii: `ShippingCostCalculator` (contextul) primește strategia metodei (`StandardShipping`, `ExpressShipping`, `StorePickup`) din `ShippingCostStrategies`. Tarifele implicite (`STANDARD_SHIPPING_RATES`, în cenți): **standard** 15.00, gratuit de la 300.00 valoare a mărfii (înainte de reducere); **express** 30.00 plus 2.00 pentru fiecare bucată după prima (nu există greutate pe produse, deci numărul de bucăți ține loc de greutate); **ridicare din magazin** 0. Costul se adaugă la comandă prin `ShippingDecorator` (după reducere, înainte de TVA) și e salvat în `orders.shipping_amount`, deci e în totalul pe care îl plătește clientul. `GET /shipping/quote` arată, înainte de checkout, costul fiecărei metode pentru coșul curent, cu aceleași strategii ca la plasarea comenzii.

**Expediere (ADMIN).** `POST /orders/:id/shipment` pentru o comandă `PAID`: revendică livrarea (unică pe comandă), o predă curierului metodei de livrare (`STANDARD` → poștă, `EXPRESS` → curier rapid, `STORE_PICKUP` → magazin), trece comanda în `SHIPPED` (State) și emite `OrderShipped`. Curierii sunt **mock-uri locale** (fără rețea) cu API-uri deliberat diferite (curier rapid: `shipments.book`, erori cu `httpStatus`; poștă: `registerParcel`, fără excepții, valoare text, greutate în grame), aduse la portul `CourierService` prin adaptoare; id-urile lor sunt unice la fiecare pornire. `GET /orders/:id/shipment` (proprietarul sau ADMIN) arată livrarea; cât timp coletul e la curier, starea se reîmprospătează din urmărirea lui (`CREATED` → `IN_TRANSIT` → `DELIVERED`; curierul rapid avansează după 1 minut / 4 ore, poșta după 1 oră / 2 zile).

| Situație                                  | Răspuns                                                                           | Livrarea / comanda                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| expediată                                 | **201**                                                                           | `CREATED`, comanda `SHIPPED`                               |
| client (nu ADMIN) / fără token            | **403** / **401**                                                                 | neschimbate                                                |
| comandă neplătită, anulată sau rambursată | **409** `ORDER_NOT_SHIPPABLE`                                                     | -                                                          |
| comandă deja expediată (a doua cerere)    | **409** `ORDER_ALREADY_SHIPPED`                                                   | neschimbate                                                |
| expediere simultană / deja în curs        | **409** `SHIPMENT_IN_PROGRESS`                                                    | doar o cerere ajunge la curier                             |
| curierul refuză adresa / eroare / timeout | **422** `SHIPMENT_REJECTED` / **502** `COURIER_ERROR` / **504** `COURIER_TIMEOUT` | `FAILED` (cu motiv); comanda rămâne `PAID`; se poate relua |

**Fără dublă expediere, nici la cereri simultane:** tabela `shipments` are `order_id` **unic**; livrarea se _revendică_ inserând-o și doar cererea care a inserat-o ajunge la curier (reluarea unei livrări `FAILED` e tot o revendicare atomică, cu `UPDATE … WHERE status = …`). Dacă trecerea comenzii în `SHIPPED` eșuează după ce curierul a preluat coletul, livrarea rămâne `CREATED`, iar o nouă cerere duce la capăt doar trecerea comenzii, fără un al doilea colet.

**Situații simulate pentru demo și teste** (la preluarea coletului, pe ambii curieri): cod poștal `00000` sau valoare declarată (totalul comenzii) `777.01` = adresă nelivrabilă (**422**); `00001` / `777.02` = eroare la curier (**502**); `00002` / `777.03` = timeout (**504**). Ridicarea din magazin nu apelează un curier extern, deci nu are situații simulate.

### Configurare comenzi (variabile de mediu)

| Variabilă                                              | Implicit            | Rol                                                                                                                                                    |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VAT_PERCENT`                                          | `19`                | cota TVA (0 = fără TVA)                                                                                                                                |
| `DISCOUNT_TIERS`                                       | `50000:5,100000:10` | praguri `cenți:procent` (de la 500.00 → 5%, de la 1000.00 → 10%); gol = fără reduceri; pragurile trebuie să fie distincte, cu procent strict crescător |
| `SHIPPING_COUNTRIES`                                   | `RO,MD`             | țările de livrare (coduri ISO)                                                                                                                         |
| `MAX_ORDER_AMOUNT_CENTS`                               | `100000000`         | totalul maxim al unei comenzi (cenți, cel mult 2147483647)                                                                                             |
| `FRAUD_MAX_ORDERS_PER_WINDOW` / `FRAUD_WINDOW_SECONDS` | `5` / `600`         | câte comenzi are voie un client într-o fereastră de timp                                                                                               |
| `FRAUD_SUSPICIOUS_AMOUNT_CENTS`                        | `50000000`          | peste acest total, comanda cere verificare manuală (e refuzată automat)                                                                                |
| `PAYMENT_WEBHOOK_SECRET`                               | (obligatoriu)       | secretul HMAC al webhook-urilor furnizorilor de plată (minim 16 caractere; valoarea din `.env.example` e refuzată în producție)                        |

## Teste și calitatea codului

```bash
npm test                 # teste unitare + de integrare (Vitest)
npm run lint             # ESLint
npm run typecheck        # verificare TypeScript fără emitere
npm run format           # Prettier
```

Testele de integrare HTTP rulează pe adaptoarele in-memory (fără bază de date). Testele de contract ale repository-urilor rulează pe in-memory **și** pe PostgreSQL, dar partea de PostgreSQL doar dacă `DATABASE_URL` este setat (din `.env`) și PostgreSQL este pornit.

## Structură

```
src/
├── shared/              # Money, erori de domeniu, Principal/Role, IdGenerator, Logger (fără dependențe externe)
├── modules/             # catalog, cart, ordering, payments, shipping, notifications, identity
│   └── <modul>/{domain,application,ports,adapters}
├── infrastructure/      # adaptoare transversale: http/ (app Express, autentificare, OpenAPI), persistence/ (client Prisma)
├── composition-root.ts  # asamblarea dependențelor (DI manual)
└── main.ts              # punct de intrare
prisma/                  # schema și migrațiile
tests/{unit,integration}
```

Regula dependențelor: `adapters → application → domain`; domeniul nu importă Express, Prisma sau SDK-uri externe.

## Design patterns implementate până acum

| Pattern                                                                                                                                                                                                      | Categorie      | Fișier                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composite (`Product` frunză, `Bundle` compus, ambele `CatalogItem`)                                                                                                                                          | Structural     | [Product.ts](src/modules/catalog/domain/Product.ts), [Bundle.ts](src/modules/catalog/domain/Bundle.ts)                                                                                                                                                                                                                                                                                                                                                           |
| Proxy cu cache (`CachingProductRepository`)                                                                                                                                                                  | Structural     | [CachingProductRepository.ts](src/modules/catalog/adapters/persistence/CachingProductRepository.ts)                                                                                                                                                                                                                                                                                                                                                              |
| Proxy de protecție (`AuthorizationProxy`)                                                                                                                                                                    | Structural     | [AuthorizationProxy.ts](src/modules/catalog/application/AuthorizationProxy.ts)                                                                                                                                                                                                                                                                                                                                                                                   |
| Builder (`OrderBuilder`)                                                                                                                                                                                     | Creațional     | [OrderBuilder.ts](src/modules/ordering/domain/OrderBuilder.ts)                                                                                                                                                                                                                                                                                                                                                                                                   |
| State (`NewState`, `PaidState`, `ShippedState`, `DeliveredState`, `CancelledState`, `RefundedState`)                                                                                                         | Comportamental | [state/](src/modules/ordering/domain/state)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Decorator (`BasePrice` → `DiscountDecorator` → `ShippingDecorator` → `VatDecorator`)                                                                                                                         | Structural     | [PriceCalculator.ts](src/modules/ordering/domain/pricing/PriceCalculator.ts)                                                                                                                                                                                                                                                                                                                                                                                     |
| Chain of Responsibility (`StockValidator` → `AddressValidator` → `AmountLimitValidator` → `FraudCheckValidator`)                                                                                             | Comportamental | [validation/](src/modules/ordering/application/validation)                                                                                                                                                                                                                                                                                                                                                                                                       |
| Observer (`InMemoryEventBus` + abonații `OrderEventLogger`, `RestockOnOrderCancelled`, `RefundOnOrderCancelled`)                                                                                             | Comportamental | [InMemoryEventBus.ts](src/shared/events/InMemoryEventBus.ts), [RestockOnOrderCancelled.ts](src/modules/ordering/application/RestockOnOrderCancelled.ts), [RefundOnOrderCancelled.ts](src/modules/payments/application/RefundOnOrderCancelled.ts)                                                                                                                                                                                                                 |
| Template Method (`AbstractPaymentProcessor` + `StripePaymentProcessor`, `PayPalPaymentProcessor`, `CashOnDeliveryPaymentProcessor`)                                                                          | Comportamental | [AbstractPaymentProcessor.ts](src/modules/payments/application/AbstractPaymentProcessor.ts), [processors/](src/modules/payments/application/processors)                                                                                                                                                                                                                                                                                                          |
| Abstract Factory (`PaymentProviderFactory` → `StripeFactory`, `PayPalFactory`, `CashOnDeliveryFactory`)                                                                                                      | Creațional     | [PaymentProviderFactory.ts](src/modules/payments/ports/out/PaymentProviderFactory.ts), [StripeFactory.ts](src/modules/payments/adapters/providers/stripe/StripeFactory.ts), [PayPalFactory.ts](src/modules/payments/adapters/providers/paypal/PayPalFactory.ts), [CashOnDeliveryFactory.ts](src/modules/payments/adapters/providers/cod/CashOnDeliveryFactory.ts)                                                                                                |
| Adapter (`StripeGateway`, `PayPalGateway`, `CashOnDeliveryGateway` peste API-uri de plată mock diferite; `FastCourierAdapter`, `PostOfficeAdapter` peste API-uri de curier mock diferite → `CourierService`) | Structural     | [StripeGateway.ts](src/modules/payments/adapters/providers/stripe/StripeGateway.ts), [PayPalGateway.ts](src/modules/payments/adapters/providers/paypal/PayPalGateway.ts), [CashOnDeliveryGateway.ts](src/modules/payments/adapters/providers/cod/CashOnDeliveryGateway.ts), [FastCourierAdapter.ts](src/modules/shipping/adapters/couriers/fast/FastCourierAdapter.ts), [PostOfficeAdapter.ts](src/modules/shipping/adapters/couriers/post/PostOfficeAdapter.ts) |
| Strategy (`ShippingCostStrategy`: `StandardShipping`, `ExpressShipping`, `StorePickup`; context `ShippingCostCalculator`)                                                                                    | Comportamental | [ShippingCostStrategy.ts](src/modules/shipping/domain/ShippingCostStrategy.ts)                                                                                                                                                                                                                                                                                                                                                                                   |

## Limitări cunoscute (Iterațiile 1-2)

- **Tokenurile JWT nu se pot revoca** și poartă rolul în ele: o schimbare de rol are efect abia după expirare (maxim 24 h, implicit 1 h).
- **Cache-ul de produse este local procesului** (`CachingProductRepository`, TTL 60 s): cu mai multe instanțe, citirile pot fi învechite până la expirare.
- **Coșul folosește „ultima scriere câștigă”**: două modificări simultane ale aceluiași coș se pot suprapune (fără versionare optimistă).
- **Verificările de integritate din administrare** (ciclu de categorii, nume unic pe nivel) sunt citire-apoi-scriere, fără constrângeri în baza de date; conflictele de tip cheie străină sau unicitate sunt traduse în **409**, dar două cereri concurente pot trece amândouă de verificarea de ciclu.
- `GET /categories`, `GET /bundles` nu sunt paginate (volum mic de date așteptat).
- Pachetele imbricate există în domeniu (Composite recursiv), dar se salvează doar pachete formate din produse simple.

## Limitări cunoscute (Iterația 3, partea A)

- **Livrarea și plata au acum module proprii** (Iterațiile 4-5); `PATCH /orders/:id/status` rămâne la ADMIN și poate marca manual `SHIPPED`, fără curier (vezi limitările Iterației 5).
- **Fără acțiuni ale clientului asupra comenzii**: clientul nu poate anula singur o comandă; nu există listare a tuturor comenzilor pentru ADMIN (doar detalii după id).
- **Comanda nu păstrează istoricul tranzițiilor** (doar statusul curent și `paidAt`); auditul apare cu Command + istoric în Iterația 6.
- **Cache-ul de produse** se invalidează la plasarea unei comenzi doar în procesul curent (vezi limitarea cache-ului local de mai sus).
- **Totalul unei comenzi e limitat la 21.474.836,47** (ce încape într-un `INTEGER` PostgreSQL); peste limită comanda e refuzată cu **422**. Limita se aplică și subtotalului, reducerii, TVA și totalului final (după TVA).
- **Coșul rămâne „ultima scriere câștigă”**: dacă același utilizator modifică coșul în paralel cu plasarea comenzii, un articol deja comandat poate reapărea în coș; la o nouă comandă stocul se scade din nou. Plasarea în sine nu pierde date (coșul modificat între timp oprește comanda cu **409** `CART_CHANGED`).
- **Prețul copiat în comandă vine din catalog (cache local, TTL 60 s)**: cu mai multe instanțe, un preț schimbat de ADMIN poate fi copiat cu întârziere de până la 60 s.
- **Comenzile salvate se reconstruiesc cu aceleași validări ca la creare**: o limită înăsprită ulterior ar putea face ilizibile comenzile vechi (la schimbarea limitelor e nevoie de migrare).
- **Erorile Prisma neașteptate se loghează cu mesajul lor**, care poate conține argumentele interogării (inclusiv adresa de livrare); în producție logurile trebuie tratate ca date personale.
- **Referințele din comandă către produs/pachet nu au cheie străină** (produsul poate fi șters ulterior; comanda își păstrează numele și prețul copiate).

## Limitări cunoscute (Iterația 3, partea B)

- **Repunerea stocului nu e atomică cu anularea și nu are reluare**: evenimentele sunt în proces, fără outbox. Dacă procesul sau baza de date cad între salvarea anulării și repunere, comanda rămâne `CANCELLED` (iar `CANCELLED → CANCELLED` e invalid), deci stocul nu se mai repune singur; eșecul se loghează la nivel `error` cu id-ul comenzii. Repunerea e idempotentă, deci poate fi reluată oricând în siguranță (un job de reconciliere pe comenzile `CANCELLED` fără înregistrare în `order_stock_restorations` rămâne de făcut).
- **Repunerea stocului se calculează din catalogul de la momentul anulării** (`stockRequirements()`), nu din ce s-a scăzut la plasare: dacă un pachet s-a schimbat între comandă și anulare, se repune după compoziția nouă (stocul poate rămâne ușor în plus sau în minus); un articol șters între timp e sărit (avertisment în log). Corect ar fi să se salveze deducerile la plasare (`order_stock_deductions`). Stocul repus este plafonat la maximul din catalog (1.000.000).
- **Pragurile de reducere și limitele de sumă sunt în cenți, fără monedă** (aceeași valoare pentru RON, EUR și USD); o singură cotă de TVA pentru toate produsele, prețurile din catalog fiind fără TVA; reducerea are o singură treaptă (cea mai mare atinsă), fără cupoane sau reduceri pe client. Costul de livrare intră în preț din Iterația 5 (`ShippingDecorator`).
- **Verificarea anti-fraudă e simplă și „best effort”**: o comandă peste pragul suspect e refuzată (nu intră într-o coadă de verificare manuală), iar numărătoarea comenzilor recente se face înainte de plasare, fără blocare comună cu aceasta, deci cereri simultane ale aceluiași client pot depăși limita. Nu e o garanție, ci un prag moale.
- **`AddressValidator` verifică doar țara** (listă configurabilă); nu validează orașul sau codul poștal. **Ordinea erorilor**: formatul adresei și depășirea limitei `INTEGER` se verifică la construirea comenzii, înaintea lanțului; deci un coș cu stoc insuficient și adresă invalidă răspunde **422** `INVALID_ADDRESS`, nu 409.
- **Notificările reale vin în Iterația 5** (`REFUNDED` emite acum `OrderRefunded`). Comenzile create înainte de migrarea `pricing_and_restock` au `discount` și `vat` 0.

## Limitări cunoscute (Iterația 4)

- **Furnizorii de plată sunt mock-uri în memorie**: nu fac apeluri de rețea și **nu păstrează starea între porniri** (tranzacțiile, capturile, rambursările). Plățile din PostgreSQL rămân, dar o plată încasată înainte de o repornire nu mai poate fi rambursată de mock (furnizorul „nu o cunoaște”): rambursarea eșuează (502), iar plata revine în `CAPTURED`. Un singur secret (`PAYMENT_WEBHOOK_SECRET`) semnează webhook-urile tuturor furnizorilor mock (o semnătură Stripe validă e și semnătură COD validă pentru corpul `t.corp`, dar acela nu are formatul COD, deci pică la 422); webhook-urile nu se deduplică pe `eventId` (nu au efecte). Un webhook fără `Content-Type: application/json` primește 403 (corp gol), nu 415.
- **Fără reconciliere sau reluare automată**: o plată rămasă `PENDING` (procesul a căzut în timpul plății) blochează o nouă plată a comenzii cu **409** `PAYMENT_IN_PROGRESS`, iar una rămasă `REFUNDING` nu se mai reia singură; o rambursare refuzată de furnizor la anulare se loghează și plata rămâne `CAPTURED`, fără a fi reîncercată (nu există job de reconciliere sau outbox, ca la repunerea stocului). Un **timeout** e tratat ca eșec (`FAILED`): în realitate rezultatul e necunoscut; reluarea trimite aceleași chei de idempotență, deci un furnizor real care le respectă nu încasează de două ori. Dacă încasarea reușește, dar inserarea rezultatului în baza de date eșuează, banii rămân încasați cu plata `PENDING` (se loghează id-urile pentru reconciliere manuală).
- **Rezultat necunoscut după timeout și rezervări fără anulare**: un timeout la _captare_ (după o autorizare reușită) lasă plata `FAILED` cu id-ul rezervării păstrat; dacă furnizorul a încasat totuși, nimic nu reconciliază automat (webhook-ul doar loghează), iar o comandă anulată apoi nu se rambursează (`wasPaid` e fals). Portul `PaymentGateway` nu are `void`/anulare a rezervării, deci o rezervare rămasă pe jumătate se eliberează doar la furnizor. Captarea la ramburs nu e idempotentă în mock (a doua confirmare dă 409).
- **Aceeași cheie de idempotență la fiecare reluare** (`pay:<orderId>`, trimisă și furnizorului): mock-urile rețin doar succesele, dar un furnizor real poate returna din cache același refuz o perioadă; ar fi nevoie de o cheie per încercare (`pay:<orderId>:<n>`, cu contor salvat), cu aceeași cheie doar după un timeout.
- **Răspunsul `PATCH /orders/:id/status` la o anulare plătită e „vechi”**: rambursarea rulează sincron în handlerul evenimentului și comanda e deja `REFUNDED`, dar răspunsul întoarce starea `CANCELLED` (o citire ulterioară arată `REFUNDED`).
- **Webhook-urile doar se reconciliază**: nu schimbă starea plății sau a comenzii (sursa de adevăr e răspunsul sincron al gateway-ului); un eveniment în dezacord se loghează. Ramburs-ul nu are timestamp în semnătură (livrare reluabilă; e inofensiv, fiindcă webhook-ul nu are efecte). Endpoint-ul nu are limită de cereri.
- **Rambursarea la ramburs și plata sunt simulate imediat**: la `CASH_ON_DELIVERY` banii se consideră încasați la plată (în realitate, la livrare); rambursarea e mereu integrală (fără rambursări parțiale).
- **ADMIN poate încă marca manual `PAID`/`REFUNDED`** prin `PATCH /orders/:id/status`, fără plată: o comandă marcată `PAID` manual se anulează fără rambursare (avertisment în log), iar un `REFUNDED` manual nu returnează banii unei plăți existente.
- **Fereastra de rambursare PayPal (180 de zile) se măsoară de la crearea plății**, nu de la momentul captării (nu există coloană separată); o plată reluată după un eșec își păstrează data de creare.
- **Un singur furnizor per metodă de plată și o singură plată per comandă** (nu există plată în rate, plată parțială sau schimbarea metodei după plasare). Prag de sumă per furnizor în cenți, fără monedă (la fel ca la comenzi). Nu există listare a tuturor plăților pentru ADMIN.
- **Modulul `payments` aduce un eveniment `OrderCancelled` doar prin numele și forma lui** (contract minim declarat în `RefundOnOrderCancelled`), fără dependență de tipurile modulului `ordering`; dacă `ordering` ar redenumi evenimentul sau câmpul `wasPaid`, compilatorul nu avertizează (testele de integrare da).

## Limitări cunoscute (Iterația 5, livrări)

- **Curierii sunt mock-uri în memorie**: nu fac apeluri de rețea și **nu păstrează starea între porniri**. Un colet preluat înainte de o repornire nu mai e cunoscut de mock: urmărirea lui eșuează (502), iar `GET /orders/:id/shipment` întoarce ultima stare salvată. Ridicarea din magazin e un „curier” local (fără apel extern), cu aceeași limită pentru codul de ridicare.
- **Tarifele sunt în cod** (`STANDARD_SHIPPING_RATES`), nu în configurare, în cenți și fără monedă (aceeași valoare pentru RON, EUR și USD); nu există greutate sau dimensiuni pe produse (numărul de bucăți ține loc de greutate), nici zone sau tarife pe țară. Livrarea standard gratuită se decide după valoarea mărfii _înainte_ de reducere.
- **Cotația (`GET /shipping/quote`) se bazează pe coșul curent**: totalul comenzii folosește costul calculat la plasare, deci un coș modificat între cotație și plasare schimbă costul. Costul livrat unei comenzi existente nu se recalculează.
- **Fără reconciliere sau reluare automată**: o livrare rămasă `PENDING` (procesul a căzut între revendicare și răspunsul curierului) blochează o nouă expediere cu **409** `SHIPMENT_IN_PROGRESS` încă 2 minute, apoi e considerată abandonată și se reia (curierul primește aceeași cheie de idempotență, deci regăsește un colet deja creat); două reluări simultane ale unui `PENDING` abandonat pot ajunge amândouă la curier, dar doar una salvează rezultatul și trece comanda în `SHIPPED`; dacă curierul a preluat coletul, dar salvarea rezultatului eșuează, id-urile se loghează pentru reconciliere manuală. Un timeout e tratat ca eșec (`FAILED`), deși rezultatul la curier e necunoscut; aceeași cheie de idempotență (`ship:<orderId>`) se trimite la fiecare reluare, iar mock-urile rețin doar succesele.
- **Portul `CourierService` nu are anulare de colet**: dacă o comandă e anulată după ce curierul a preluat coletul, dar înainte de `SHIPPED`, coletul rămâne la curier, iar livrarea rămâne `CREATED` (eroarea tranziției ajunge la ADMIN).
- **Fiecare `GET /orders/:id/shipment` cât timp coletul e în tranzit apelează curierul** (fără cache sau limitare): cu un curier real, cererile repetate ale clienților s-ar transforma în apeluri externe.
- **Urmărirea se face doar la cerere** (`GET /orders/:id/shipment`), fără webhook-uri de la curier, și **nu schimbă comanda**: `DELIVERED` la curier nu trece comanda în `DELIVERED` (rămâne la ADMIN, prin `PATCH`), iar `RETURNED` nu declanșează nimic.
- **ADMIN poate marca manual `SHIPPED`** prin `PATCH /orders/:id/status`, fără livrare prin curier (apoi `POST /orders/:id/shipment` răspunde **409** `ORDER_ALREADY_SHIPPED`).
- **O singură livrare per comandă** (un singur colet): nu există livrare parțială, schimbarea curierului sau a adresei după expediere, anularea unei livrări, nici listare a tuturor livrărilor pentru ADMIN.
- **Adresa și numele destinatarului se trimit curierului** (date personale, ca la orice curier real); nu se loghează, dar se păstrează în comandă.
