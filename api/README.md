# reeload-api

NestJS (TypeScript, ESM) API that sits beside the Supabase backend in this repo.
The database, RLS, workflow functions and Edge Functions stay in `../supabase`.

## Run locally

```bash
cd api
npm install
cp .env.example .env   # PORT=4000, CLIENT_URL=http://localhost:3000
npm run start:dev
```

The API listens on http://localhost:4000 and allows CORS from `CLIENT_URL`
(the Next.js client in `reeload-client`).

## Scripts

| Command            | What it does                 |
| ------------------ | ---------------------------- |
| `npm run start:dev`| Start with watch mode        |
| `npm run build`    | Compile to `dist/`           |
| `npm run start:prod` | Run the compiled build     |
| `npm test`         | Unit tests (Vitest)          |
| `npm run test:e2e` | End-to-end tests (Vitest)    |
