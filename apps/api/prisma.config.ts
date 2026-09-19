import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // The disposable migration-compatibility proof uses a temporary copy of
    // only the pre-C24C-1 migration history.  Normal development and CI runs
    // retain the checked-in migration directory.
    path: process.env.LOTUS_PRISMA_MIGRATIONS_PATH ?? "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
