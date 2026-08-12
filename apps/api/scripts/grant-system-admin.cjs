#!/usr/bin/env node
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../dist/generated/prisma/client.js");
const { PrismaAuthorizationRepository } = require("../dist/modules/authorization/infrastructure/prisma-authorization.repository.js");
const { normalizeEmail } = require("../dist/modules/auth/auth.utils.js");

async function main() {
  const emailArgument = process.argv[2];
  if (typeof emailArgument !== "string" || emailArgument.trim().length === 0 || process.argv.length !== 3) {
    throw new Error("Usage: pnpm auth:grant-system-admin <email>");
  }
  if (typeof process.env.DATABASE_URL !== "string" || process.env.DATABASE_URL.length === 0) {
    throw new Error("DATABASE_URL is required.");
  }

  const email = normalizeEmail(emailArgument);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const result = await new PrismaAuthorizationRepository(prisma).grantSystemAdminByEmail(email);
    if (result.kind === "GRANTED") {
      process.stdout.write(`Granted SYSTEM_ADMIN to ${result.email}. Audit record created.\n`);
      return;
    }
    if (result.kind === "ALREADY_ASSIGNED") {
      process.stdout.write(`${result.email} already has SYSTEM_ADMIN. No change made.\n`);
      return;
    }
    if (result.kind === "USER_NOT_FOUND") {
      throw new Error(`No user exists for ${result.email}.`);
    }
    throw new Error(`${result.email} must be ACTIVE and not soft-deleted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
