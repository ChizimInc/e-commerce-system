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

| Zonă             | Rută                                                                                                                      | Acces                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Auth             | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                                                                 | public / public / autentificat |
| Catalog (citire) | `GET /products?q=&categoryId=&limit=&offset=`, `GET /products/:id`, `GET /categories`, `GET /bundles`, `GET /bundles/:id` | public                         |
| Catalog (admin)  | `POST/PATCH/DELETE /products`, `/categories`, `/bundles`                                                                  | ADMIN                          |
| Coș              | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`, `DELETE /cart/items/:itemId`, `DELETE /cart`                | autentificat                   |
| Comenzi          | `POST /orders`, `GET /orders?limit=&offset=`, `GET /orders/:id`                                                           | autentificat (doar ale lui)    |
| Comenzi (admin)  | `PATCH /orders/:id/status`                                                                                                | ADMIN                          |

Detalii, scheme și exemple: Swagger UI la `/docs`.

### Comenzi și ciclul de viață

`POST /orders` creează o comandă din coșul utilizatorului (corp: `address`, `deliveryMethod`, `paymentMethod`). Prețurile și numele se **copiază** în comandă la momentul creării; stocul se scade (pentru pachete, din componente), comanda se salvează și liniile comandate se scot din coș, **într-o singură tranzacție**. Clientul vede doar comenzile lui (comanda altcuiva răspunde **404**, ca una inexistentă); ADMIN poate vedea orice comandă.

Statusul se schimbă doar de ADMIN, prin `PATCH /orders/:id/status` cu `{ "status": "PAID" }`. Tranzițiile permise (State):

```
NEW ──► PAID ──► SHIPPED ──► DELIVERED
 │       │
 │       └──► CANCELLED ──► REFUNDED   (rambursare doar dacă a fost plătită)
 └──────────► CANCELLED
```

Orice altă tranziție răspunde **422** cu codul `INVALID_ORDER_TRANSITION`. Metodele de livrare (`STANDARD`, `EXPRESS`, `STORE_PICKUP`) și de plată (`CARD`, `PAYPAL`, `CASH_ON_DELIVERY`) sunt deocamdată simple valori; logica lor vine în Iterațiile 4-5.

### Preț, validare și evenimente

**Preț (Decorator).** La creare, comanda calculează `subtotal` (suma liniilor), `discount`, `vat` și `total = subtotal - discount + vat` și le păstrează toate (în cenți, cu `Money`). Prețurile din catalog sunt **fără TVA**; reducerea se aplică pe subtotal (cel mai mare prag atins), iar TVA pe subtotalul redus. Orice sumă care ar depăși limita `INTEGER` din baza de date (inclusiv totalul după TVA) este refuzată cu **422** `INVALID_ORDER`, nu cu 500.

**Validare înainte de plasare (Chain of Responsibility).** `StockValidator → AddressValidator → AmountLimitValidator → FraudCheckValidator`; prima verigă care refuză oprește comanda, fără nicio modificare de stoc, coș sau comandă:

| Verigă                 | Refuză când                                                               | Răspuns                                                |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `StockValidator`       | stocul disponibil nu acoperă o linie                                      | **409** `INSUFFICIENT_STOCK`                           |
| `AddressValidator`     | țara nu e în `SHIPPING_COUNTRIES`                                         | **422** `UNSUPPORTED_COUNTRY`                          |
| `AmountLimitValidator` | totalul depășește `MAX_ORDER_AMOUNT_CENTS`                                | **422** `AMOUNT_LIMIT_EXCEEDED`                        |
| `FraudCheckValidator`  | totalul depășește pragul suspect, sau prea multe comenzi într-o fereastră | **422** `ORDER_FLAGGED` / **429** `ORDER_RATE_LIMITED` |

Lanțul se asamblează în `composition-root.ts` (`chainOf(...)`): o verigă nouă se adaugă acolo, fără a modifica `OrderService`.

**Evenimente (Observer).** După ce o tranziție este salvată, `OrderService` publică pe `EventBus` (`shared/events`) `OrderPlaced`, `OrderPaid`, `OrderShipped`, `OrderDelivered` sau `OrderCancelled` (rambursarea nu emite încă nimic). Evenimentele nu poartă adresa sau numele destinatarului. Abonații se înregistrează în composition root: un jurnal (`OrderEventLogger`, doar id comandă, total, număr de linii) și `RestockOnOrderCancelled`, care **repune stocul** unei comenzi anulate, inclusiv componentele pachetelor. Repunerea este idempotentă (tabela `order_stock_restorations`): aceeași anulare procesată de două ori repune stocul o singură dată. O eroare dintr-un abonat se loghează și nu oprește ceilalți abonați și nu afectează comanda.

### Configurare comenzi (variabile de mediu)

| Variabilă                                              | Implicit            | Rol                                                                                                                                                    |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VAT_PERCENT`                                          | `19`                | cota TVA (0 = fără TVA)                                                                                                                                |
| `DISCOUNT_TIERS`                                       | `50000:5,100000:10` | praguri `cenți:procent` (de la 500.00 → 5%, de la 1000.00 → 10%); gol = fără reduceri; pragurile trebuie să fie distincte, cu procent strict crescător |
| `SHIPPING_COUNTRIES`                                   | `RO,MD`             | țările de livrare (coduri ISO)                                                                                                                         |
| `MAX_ORDER_AMOUNT_CENTS`                               | `100000000`         | totalul maxim al unei comenzi (cenți, cel mult 2147483647)                                                                                             |
| `FRAUD_MAX_ORDERS_PER_WINDOW` / `FRAUD_WINDOW_SECONDS` | `5` / `600`         | câte comenzi are voie un client într-o fereastră de timp                                                                                               |
| `FRAUD_SUSPICIOUS_AMOUNT_CENTS`                        | `50000000`          | peste acest total, comanda cere verificare manuală (e refuzată automat)                                                                                |

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

| Pattern                                                                                                          | Categorie      | Fișier                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composite (`Product` frunză, `Bundle` compus, ambele `CatalogItem`)                                              | Structural     | [Product.ts](src/modules/catalog/domain/Product.ts), [Bundle.ts](src/modules/catalog/domain/Bundle.ts)                                                  |
| Proxy cu cache (`CachingProductRepository`)                                                                      | Structural     | [CachingProductRepository.ts](src/modules/catalog/adapters/persistence/CachingProductRepository.ts)                                                     |
| Proxy de protecție (`AuthorizationProxy`)                                                                        | Structural     | [AuthorizationProxy.ts](src/modules/catalog/application/AuthorizationProxy.ts)                                                                          |
| Builder (`OrderBuilder`)                                                                                         | Creațional     | [OrderBuilder.ts](src/modules/ordering/domain/OrderBuilder.ts)                                                                                          |
| State (`NewState`, `PaidState`, `ShippedState`, `DeliveredState`, `CancelledState`, `RefundedState`)             | Comportamental | [state/](src/modules/ordering/domain/state)                                                                                                             |
| Decorator (`BasePrice` → `DiscountDecorator` → `VatDecorator`)                                                   | Structural     | [PriceCalculator.ts](src/modules/ordering/domain/pricing/PriceCalculator.ts)                                                                            |
| Chain of Responsibility (`StockValidator` → `AddressValidator` → `AmountLimitValidator` → `FraudCheckValidator`) | Comportamental | [validation/](src/modules/ordering/application/validation)                                                                                              |
| Observer (`InMemoryEventBus` + abonații `OrderEventLogger`, `RestockOnOrderCancelled`)                           | Comportamental | [InMemoryEventBus.ts](src/shared/events/InMemoryEventBus.ts), [RestockOnOrderCancelled.ts](src/modules/ordering/application/RestockOnOrderCancelled.ts) |

## Limitări cunoscute (Iterațiile 1-2)

- **Tokenurile JWT nu se pot revoca** și poartă rolul în ele: o schimbare de rol are efect abia după expirare (maxim 24 h, implicit 1 h).
- **Cache-ul de produse este local procesului** (`CachingProductRepository`, TTL 60 s): cu mai multe instanțe, citirile pot fi învechite până la expirare.
- **Coșul folosește „ultima scriere câștigă”**: două modificări simultane ale aceluiași coș se pot suprapune (fără versionare optimistă).
- **Verificările de integritate din administrare** (ciclu de categorii, nume unic pe nivel) sunt citire-apoi-scriere, fără constrângeri în baza de date; conflictele de tip cheie străină sau unicitate sunt traduse în **409**, dar două cereri concurente pot trece amândouă de verificarea de ciclu.
- `GET /categories`, `GET /bundles` nu sunt paginate (volum mic de date așteptat).
- Pachetele imbricate există în domeniu (Composite recursiv), dar se salvează doar pachete formate din produse simple.

## Limitări cunoscute (Iterația 3, partea A)

- **Plata și livrarea sunt doar stări**: `PAID`/`SHIPPED` se setează de ADMIN manual, fără procesator de plată sau curier (Iterațiile 4-5); totalul nu include cost de livrare (Iterația 5).
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
- **Pragurile de reducere și limitele de sumă sunt în cenți, fără monedă** (aceeași valoare pentru RON, EUR și USD); o singură cotă de TVA pentru toate produsele, prețurile din catalog fiind fără TVA; reducerea are o singură treaptă (cea mai mare atinsă), fără cupoane sau reduceri pe client. Costul de livrare (inclusiv `EXPRESS`) nu intră încă în preț: locul e pregătit în `priceCalculatorFor` pentru Iterația 5.
- **Verificarea anti-fraudă e simplă și „best effort”**: o comandă peste pragul suspect e refuzată (nu intră într-o coadă de verificare manuală), iar numărătoarea comenzilor recente se face înainte de plasare, fără blocare comună cu aceasta, deci cereri simultane ale aceluiași client pot depăși limita. Nu e o garanție, ci un prag moale.
- **`AddressValidator` verifică doar țara** (listă configurabilă); nu validează orașul sau codul poștal. **Ordinea erorilor**: formatul adresei și depășirea limitei `INTEGER` se verifică la construirea comenzii, înaintea lanțului; deci un coș cu stoc insuficient și adresă invalidă răspunde **422** `INVALID_ADDRESS`, nu 409.
- **`REFUNDED` nu emite eveniment** (apare cu plata, Iterația 4); notificările reale vin în Iterația 5. Comenzile create înainte de migrarea `pricing_and_restock` au `discount` și `vat` 0.
