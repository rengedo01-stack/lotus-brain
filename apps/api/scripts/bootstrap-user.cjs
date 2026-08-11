#!/usr/bin/env node
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const { createHash, randomBytes } = require("node:crypto");
const argon2 = require("argon2");

async function main() {
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const prisma = new PrismaClient();
  const email = (await prompt("Email: ")).trim().toLowerCase();
  const displayName = (await prompt("Display name: ")).trim();
  const password = await promptSecret("Password: ");

  if (!email || !displayName || !password) {
    throw new Error("Email, display name, and password are required.");
  }

  const existingCount = await prisma.user.count();
  if (existingCount > 0) {
    throw new Error("A user already exists; bootstrap is only allowed once.");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const created = await prisma.user.create({
    data: { email, displayName, passwordHash },
    select: { id: true, email: true, displayName: true, status: true },
  });
  stdout.write(`Created user ${created.email} (${created.id})\\n`);
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
