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

Detalii, scheme și exemple: Swagger UI la `/docs`.

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

| Pattern                                                             | Categorie  | Fișier                                                                                                 |
| ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Composite (`Product` frunză, `Bundle` compus, ambele `CatalogItem`) | Structural | [Product.ts](src/modules/catalog/domain/Product.ts), [Bundle.ts](src/modules/catalog/domain/Bundle.ts) |
| Proxy cu cache (`CachingProductRepository`)                         | Structural | [CachingProductRepository.ts](src/modules/catalog/adapters/persistence/CachingProductRepository.ts)    |
| Proxy de protecție (`AuthorizationProxy`)                           | Structural | [AuthorizationProxy.ts](src/modules/catalog/application/AuthorizationProxy.ts)                         |

## Limitări cunoscute (Iterațiile 1-2)

- **Tokenurile JWT nu se pot revoca** și poartă rolul în ele: o schimbare de rol are efect abia după expirare (maxim 24 h, implicit 1 h).
- **Cache-ul de produse este local procesului** (`CachingProductRepository`, TTL 60 s): cu mai multe instanțe, citirile pot fi învechite până la expirare.
- **Coșul folosește „ultima scriere câștigă”**: două modificări simultane ale aceluiași coș se pot suprapune (fără versionare optimistă).
- **Verificările de integritate din administrare** (ciclu de categorii, nume unic pe nivel) sunt citire-apoi-scriere, fără constrângeri în baza de date; conflictele de tip cheie străină sau unicitate sunt traduse în **409**, dar două cereri concurente pot trece amândouă de verificarea de ciclu.
- `GET /categories`, `GET /bundles` nu sunt paginate (volum mic de date așteptat).
- Pachetele imbricate există în domeniu (Composite recursiv), dar se salvează doar pachete formate din produse simple.
