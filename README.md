# E-commerce System

Sistem de e-commerce cu arhitectură hexagonală (Ports & Adapters) și extensibilitate pentru plăți, livrări și notificări. Proiect universitar TPSS + ASS.

**Stack:** Node.js 22+, TypeScript (strict), Express, PostgreSQL 16, Prisma 7, Zod, Vitest, Swagger UI.

## Cerințe

- [Node.js](https://nodejs.org/) 22 sau mai nou
- [Docker](https://www.docker.com/) cu Docker Compose (pentru PostgreSQL)

## Instalare

```bash
npm install
cp .env.example .env     # apoi setează un JWT_SECRET propriu (min. 32 de caractere)
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
npm run db:seed          # date demo (momentan nu inserează nimic)
```

## Rulare

```bash
npm run dev              # dezvoltare, cu reload automat
npm run build && npm start   # producție (din dist/)
```

- Health check: <http://localhost:3000/health> (verifică și conexiunea la baza de date)
- Documentație API (Swagger UI): <http://localhost:3000/docs>

## Teste și calitatea codului

```bash
npm test                 # teste unitare + de integrare (Vitest)
npm run lint             # ESLint
npm run typecheck        # verificare TypeScript fără emitere
npm run format           # Prettier
```

Testele de integrare cu baza de date rulează doar dacă `DATABASE_URL` este setat (din `.env`) și PostgreSQL este pornit.

## Structură

```
src/
├── shared/              # Money, DomainError, Logger (fără dependențe externe)
├── modules/             # catalog, cart, ordering, payments, shipping, notifications, identity
│   └── <modul>/{domain,application,ports,adapters}
├── infrastructure/      # adaptoare transversale: HTTP (Express, Swagger), Prisma
├── composition-root.ts  # asamblarea dependențelor (DI manual)
└── main.ts              # punct de intrare
prisma/                  # schema și migrațiile
tests/{unit,integration}
```

Regula dependențelor: `adapters → application → domain`; domeniul nu importă Express, Prisma sau SDK-uri externe.
