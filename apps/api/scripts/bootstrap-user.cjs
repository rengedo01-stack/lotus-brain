#!/usr/bin/env node
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const argon2 = require("argon2");
const { PrismaPg } = require("@prisma/adapter-pg");

async function main() {
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { SystemRoleCodes } = require("../dist/modules/authorization/authorization.constants.js");
  if (typeof process.env.DATABASE_URL !== "string" || process.env.DATABASE_URL.length === 0) {
    throw new Error("DATABASE_URL is required.");
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const [emailInput, displayNameInput, passwordInput] = stdin.isTTY
      ? [
          await prompt("Email: "),
          await prompt("Display name: "),
          await promptSecret("Password: "),
        ]
      : await readNonInteractiveInputs();
    const email = emailInput.trim().toLowerCase();
    const displayName = displayNameInput.trim();
    const password = passwordInput;

    if (!email || !displayName || !password) {
      throw new Error("Email, display name, and password are required.");
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const created = await prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.user.count();
      if (existingCount > 0) {
        throw new Error("A user already exists; bootstrap is only allowed once.");
      }

      const legacyRole = await transaction.role.findUnique({
        where: { code: SystemRoleCodes.LEGACY_AUTHENTICATED },
        select: { id: true },
      });
      if (legacyRole === null) {
        throw new Error("LEGACY_AUTHENTICATED role is not configured. Apply the RBAC migration before bootstrapping a user.");
      }

      const user = await transaction.user.create({
        data: { email, displayName, passwordHash },
        select: { id: true, email: true, displayName: true, status: true },
      });
      await transaction.userRole.create({
        data: { userId: user.id, roleId: legacyRole.id },
      });
      return user;
    });
    stdout.write(`Created user ${created.email} (${created.id})\n`);
  } finally {
    await prisma.$disconnect();
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function readNonInteractiveInputs() {
  const lines = [];
  for await (const line of readline.createInterface({ input: stdin, crlfDelay: Infinity })) {
    lines.push(line);
  }
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

async function promptSecret(question) {
  if (!stdin.isTTY) {
    return prompt(question);
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let value = "";
  while (true) {
    const chunk = await new Promise((resolve) => stdin.once("data", resolve));
    if (chunk === "\u0003") {
      stdout.write("\n");
      process.exit(1);
    }
    if (chunk === "\r" || chunk === "\n") {
      break;
    }
    if (chunk === "\u0008" || chunk === "\u007f") {
      value = value.slice(0, -1);
      continue;
    }
    value += chunk;
  }

  stdin.setRawMode(false);
  stdout.write("\n");
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
