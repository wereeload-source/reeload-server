# reeload-api

NestJS (TypeScript, ESM) API that sits beside the Supabase backend in this repo.
The database, RLS, workflow functions and Edge Functions stay in `../supabase`.

## Run locally

```bash
cd api
pnpm install
cp .env.example .env   # PORT=4000, CLIENT_URL=http://localhost:3000
pnpm start:dev
```

The API listens on http://localhost:4000 and allows CORS from `CLIENT_URL`
(the Next.js client in `reeload-client`).

## Scripts

| Command            | What it does                 |
| ------------------ | ---------------------------- |
| `pnpm start:dev`| Start with watch mode        |
| `pnpm build`    | Compile to `dist/`           |
| `pnpm start:prod` | Run the compiled build     |
| `pnpm test`         | Unit tests (Vitest)          |
| `pnpm test:e2e` | End-to-end tests (Vitest)    |
