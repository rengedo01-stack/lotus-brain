const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.PENDING_SESSION_DATABASE_URL;

if (databaseUrl === undefined) {
  test("pending session activation real database proof is opt-in", { skip: "PENDING_SESSION_DATABASE_URL is not set" }, () => {});
} else {
  const argon2 = require("argon2");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { PrismaAuthRepository } = require("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
  const { SessionAuthGuard } = require("../dist/modules/auth/guards/session-auth.guard.js");
  const { hashSecret, makeOpaqueToken } = require("../dist/modules/auth/auth.utils.js");
  const { UnauthorizedException } = require("@nestjs/common");

  test("pending activation PostgreSQL proof is atomic, proof-bound, and cannot lose to invalidation", async () => {
    const parsedUrl = new URL(databaseUrl);
    assert.equal(parsedUrl.pathname, "/lotus_brain_pr005o1_test", "must use the disposable PR-005O1 database");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const auth = new PrismaAuthRepository(prisma);
    const fixture = `pr005o1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userIds = [];

    function guardFor(rawToken) {
      return new SessionAuthGuard(
        { getAllAndOverride() { return false; } },
        auth,
        { get(key) { return key === "NODE_ENV" ? "development" : undefined; } },
      );
    }

    function requestFor(rawToken) {
      return {
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {},
        cookies: { lotus_session: rawToken },
      };
    }

    function context(request) {
      return {
        getClass() { return class TestController {}; },
        getHandler() { return function testHandler() {}; },
        switchToHttp() { return { getRequest() { return request; } }; },
      };
    }

    async function createUser(label, overrides = {}) {
      const { emailVerifiedAt, ...createOverrides } = overrides;
      const created = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-005O1 ${label}`,
          passwordHash: await argon2.hash("pr005o1 disposable password is long enough", { type: argon2.argon2id }),
          ...createOverrides,
        },
      });
      userIds.push(created.id);
      if (emailVerifiedAt === undefined) return created;
      return prisma.user.update({ where: { id: created.id }, data: { emailVerifiedAt } });
    }

    async function createPending(user, suffix, overrides = {}) {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const rawToken = makeOpaqueToken();
      const rawCsrf = makeOpaqueToken();
      const created = await auth.createPendingSession({
        userId: user.id,
        credentialVersion: current.credentialVersion,
        authenticationPolicyVersion: current.authenticationPolicyVersion,
        tokenHash: hashSecret(rawToken),
        csrfTokenHash: hashSecret(rawCsrf),
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
        userAgent: `real-db-${suffix}`,
        ipAddress: "127.0.0.1",
        ...overrides,
      });
      return { created, rawToken, rawCsrf };
    }

    try {
      const primary = await createUser("primary", { lastLoginAt: new Date("2026-08-29T00:00:00.000Z") });
      const pending = await createPending(primary, "primary");
      const initial = await prisma.identitySession.findUniqueOrThrow({ where: { id: pending.created.id } });
      assert.equal(initial.activatedAt, null);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: primary.id } })).lastLoginAt.toISOString(), "2026-08-29T00:00:00.000Z");
      await assert.rejects(() => guardFor(pending.rawToken).canActivate(context(requestFor(pending.rawToken))), UnauthorizedException);

      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(pending.rawToken),
        csrfTokenHash: hashSecret(pending.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "ACTIVATED");
      const activated = await prisma.identitySession.findUniqueOrThrow({ where: { id: pending.created.id } });
      assert.ok(activated.activatedAt);
      assert.ok(activated.expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60 * 1_000));
      assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: primary.id } })).lastLoginAt > new Date("2026-08-29T00:00:00.000Z"));
      assert.equal(await guardFor(pending.rawToken).canActivate(context(requestFor(pending.rawToken))), true);
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(pending.rawToken),
        csrfTokenHash: hashSecret(pending.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "ALREADY_ACTIVATED");

      const crossSession = await createPending(primary, "cross-session");
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(crossSession.rawToken),
        csrfTokenHash: hashSecret(pending.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "CSRF_INVALID");

      const expired = await createPending(primary, "expired", { expiresAt: new Date(Date.now() - 1_000) });
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(expired.rawToken),
        csrfTokenHash: hashSecret(expired.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const revoked = await createPending(primary, "revoked");
      await auth.revokeSession(revoked.created.id);
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(revoked.rawToken),
        csrfTokenHash: hashSecret(revoked.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const disabledUser = await createUser("disabled");
      const disabled = await createPending(disabledUser, "disabled");
      await prisma.user.update({ where: { id: disabledUser.id }, data: { status: "DISABLED" } });
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(disabled.rawToken),
        csrfTokenHash: hashSecret(disabled.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const deletedUser = await createUser("deleted");
      const deleted = await createPending(deletedUser, "deleted");
      await prisma.user.update({ where: { id: deletedUser.id }, data: { deletedAt: new Date() } });
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(deleted.rawToken),
        csrfTokenHash: hashSecret(deleted.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const staleCredentialUser = await createUser("stale-credential");
      const staleCredential = await createPending(staleCredentialUser, "stale-credential");
      await prisma.user.update({
        where: { id: staleCredentialUser.id },
        data: {
          passwordHash: await argon2.hash("replacement disposable password is long enough", { type: argon2.argon2id }),
          credentialVersion: { increment: 1 },
        },
      });
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(staleCredential.rawToken),
        csrfTokenHash: hashSecret(staleCredential.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const stalePolicyUser = await createUser("stale-policy", { emailVerifiedAt: new Date() });
      await prisma.webAuthnCredential.create({
        data: {
          userId: stalePolicyUser.id,
          credentialId: `${fixture}-stale-policy-credential`,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          counter: 0n,
          transports: ["internal"],
        },
      });
      const stalePolicy = await createPending(stalePolicyUser, "stale-policy");
      await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${stalePolicyUser.id} FOR UPDATE`;
        await transaction.user.update({
          where: { id: stalePolicyUser.id },
          data: { passkeyMfaEnabledAt: new Date(), authenticationPolicyVersion: { increment: 1 } },
        });
        await transaction.identitySession.updateMany({
          where: { userId: stalePolicyUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      assert.equal(await auth.activateSession({
        tokenHash: hashSecret(stalePolicy.rawToken),
        csrfTokenHash: hashSecret(stalePolicy.rawCsrf),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }), "UNAUTHORIZED");

      const concurrentUser = await createUser("concurrent");
      const concurrent = await createPending(concurrentUser, "concurrent");
      const activationResults = await Promise.all([
        auth.activateSession({ tokenHash: hashSecret(concurrent.rawToken), csrfTokenHash: hashSecret(concurrent.rawCsrf), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
        auth.activateSession({ tokenHash: hashSecret(concurrent.rawToken), csrfTokenHash: hashSecret(concurrent.rawCsrf), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
      ]);
      assert.deepEqual(activationResults.sort(), ["ACTIVATED", "ALREADY_ACTIVATED"]);

      const revokeRaceUser = await createUser("revoke-race");
      const revokeRace = await createPending(revokeRaceUser, "revoke-race");
      await Promise.all([
        auth.activateSession({ tokenHash: hashSecret(revokeRace.rawToken), csrfTokenHash: hashSecret(revokeRace.rawCsrf), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
        auth.revokeSession(revokeRace.created.id),
      ]);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: revokeRace.created.id } })).revokedAt);

      const passwordRaceUser = await createUser("password-race");
      const passwordRace = await createPending(passwordRaceUser, "password-race");
      const passwordRaceCurrent = await prisma.user.findUniqueOrThrow({ where: { id: passwordRaceUser.id } });
      await Promise.allSettled([
        auth.activateSession({ tokenHash: hashSecret(passwordRace.rawToken), csrfTokenHash: hashSecret(passwordRace.rawCsrf), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
        auth.changePassword({
          userId: passwordRaceUser.id,
          expectedCredentialVersion: passwordRaceCurrent.credentialVersion,
          passwordHash: await argon2.hash("racing replacement password is long enough", { type: argon2.argon2id }),
        }),
      ]);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: passwordRace.created.id } })).revokedAt);

      const policyRaceUser = await createUser("policy-race", { emailVerifiedAt: new Date() });
      await prisma.webAuthnCredential.create({
        data: {
          userId: policyRaceUser.id,
          credentialId: `${fixture}-policy-race-credential`,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          counter: 0n,
          transports: ["internal"],
        },
      });
      const policyRace = await createPending(policyRaceUser, "policy-race");
      const policyRaceResults = await Promise.allSettled([
        auth.activateSession({ tokenHash: hashSecret(policyRace.rawToken), csrfTokenHash: hashSecret(policyRace.rawCsrf), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
        prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${policyRaceUser.id} FOR UPDATE`;
          await transaction.user.update({
            where: { id: policyRaceUser.id },
            data: { passkeyMfaEnabledAt: new Date(), authenticationPolicyVersion: { increment: 1 } },
          });
          await transaction.identitySession.updateMany({
            where: { userId: policyRaceUser.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }),
      ]);
      assert.equal(policyRaceResults.filter((result) => result.status === "rejected").length, 0);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: policyRace.created.id } })).revokedAt);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: policyRaceUser.id } })).authenticationPolicyVersion, 2);

      const migrationUser = await createUser("migration-backfill");
      const legacy = await prisma.identitySession.create({
        data: {
          userId: migrationUser.id,
          tokenHash: hashSecret(makeOpaqueToken()),
          csrfTokenHash: hashSecret(makeOpaqueToken()),
          credentialVersion: migrationUser.credentialVersion,
          authenticationPolicyVersion: migrationUser.authenticationPolicyVersion,
          expiresAt: new Date(Date.now() + 60_000),
          activatedAt: null,
        },
      });
      await prisma.$executeRaw`
        UPDATE "IdentitySession"
        SET "activatedAt" = "createdAt"
        WHERE "id" = ${legacy.id} AND "activatedAt" IS NULL
      `;
      const backfilled = await prisma.identitySession.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.ok(backfilled.activatedAt);
    } finally {
      await prisma.notificationOutbox.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.identityAuditLog.deleteMany({ where: { targetUserId: { in: userIds } } });
      await prisma.passwordRecoveryToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passkeyMfaLoginTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.webAuthnStepUpChallenge.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.webAuthnRegistrationChallenge.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.webAuthnCredential.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.identitySession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });
}
