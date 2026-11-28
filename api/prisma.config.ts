import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need a direct (session) connection. On Supabase that is DIRECT_URL (port 5432); the app itself
  // uses DATABASE_URL, the transaction pooler (port 6543). Locally both are the same database.
  // `prisma generate` needs no database, so a fresh clone (or CI) installs without either being set.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || '' },
});
