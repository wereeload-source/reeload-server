# reeload-api

NestJS 12 (TypeScript, ESM) API for ReelOps, on Postgres through Prisma 7. The full guide, rules table and route list are in the [repository README](../README.md).

```bash
pnpm install && cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm start:dev                     # http://localhost:4000
```

| Command | What it does |
| --- | --- |
| `pnpm start:dev` | Start with watch mode |
| `pnpm build` | Compile to `dist/` (type-checks everything) |
| `pnpm start:prod` | Run the compiled build |
| `pnpm db:generate` | Regenerate the Prisma client into `src/generated` (also runs on install) |
| `pnpm db:migrate` / `pnpm db:deploy` | Create and apply migrations (dev) / apply them (production) |
| `pnpm db:seed` | Demo accounts and sample jobs (dev only) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Role-by-role tests against a migrated, seeded database |
