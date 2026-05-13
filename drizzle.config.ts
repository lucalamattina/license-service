import { defineConfig } from 'drizzle-kit';

const DEFAULT_URL = 'postgres://license_service:license_service@localhost:5433/license_service';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_URL,
  },
});
