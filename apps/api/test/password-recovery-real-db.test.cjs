const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.PASSWORD_RECOVERY_DATABASE_URL;

if (databaseUrl === undefined) {
  test("password-recovery real database proof is opt-in", { skip: "PASSWORD_RECOVERY_DATABASE_URL is not set" }, () => {});
} else {
  const argon2 = require("argon2");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { ChangePasswordUseCase } = require("../dist/modules/auth/application/auth.use-cases.js");
  const { hashSecret, makeOpaqueToken } = require("../dist/modules/auth/auth.utils.js");
  const { PrismaAuthRepository } = require("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
  const { NotificationOutboxWorker } = require("../dist/modules/notification/application/notification-outbox.worker.js");
  const { PasswordRecoveryService } = require("../dist/modules/notification/application/password-recovery.service.js");
  const { PasswordRecoveryTokenInvalidError } = require("../dist/modules/notification/application/recovery-channel.errors.js");
  const { PrismaRecoveryChannelRepository } = require("../dist/modules/notification/infrastructure/prisma-recovery-channel.repository.js");

  const CURRENT_PASSWORD = "current database recovery password is long enough";

  test("password recovery preserves generation binding, atomic reset, and concurrency invariants in PostgreSQL", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const repository = new PrismaRecoveryChannelRepository(prisma);
    const service = new PasswordRecoveryService(repository);
    const authRepository = new PrismaAuthRepository(prisma);
    const fixture = `pr004i-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userIds = [];
    const delivered = [];
    const worker = new NotificationOutboxWorker(
      repository,
      {
        async sendEmailVerification() { throw new Error("not expected"); },
        async sendPasswordRecovery(delivery) { delivered.push(delivery); },
        async sendPasswordResetCompleted(delivery) { delivered.push(delivery); },
      },
      { get: () => "https://trusted.example.test" },
    );

    async function createUser(label, overrides = {}) {
      const user = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-004I ${label}`,
          passwordHash: await argon2.hash(CURRENT_PASSWORD, { type: argon2.argon2id }),
          ...overrides,
        },
      });
      userIds.push(user.id);
      return user;
    }

    async function verifyUser(user) {
      return prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }

    async function createSession(user) {
      return prisma.identitySession.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(makeOpaqueToken()),
          csrfTokenHash: hashSecret(makeOpaqueToken()),
          credentialVersion: user.credentialVersion,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }

    async function createRecoveryToken(user, rawToken = makeOpaqueToken(), overrides = {}) {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const stored = await prisma.passwordRecoveryToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(rawToken),
          credentialVersionSnapshot: current.credentialVersion,
          emailVerificationVersionSnapshot: current.emailVerificationVersion,
          expiresAt: new Date(Date.now() + 60_000),
          ...overrides,
        },
      });
      return { rawToken, stored };
    }

    async function changeEmailGeneration(user, label) {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      return prisma.user.update({
        where: { id: user.id },
        data: {
          email: `${fixture}-${label}@example.test`,
          emailVerifiedAt: null,
          emailVerificationVersion: current.emailVerificationVersion + 1,
        },
      });
    }

    try {
      const eligible = await verifyUser(await createUser("eligible"));
      const unverified = await createUser("unverified");
      const disabled = await verifyUser(await createUser("disabled", { status: "DISABLED" }));
      const deleted = await verifyUser(await createUser("deleted"));
      await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

      const before = await prisma.user.findUniqueOrThrow({ where: { id: eligible.id } });
      await Promise.all([
        repository.requestPasswordRecovery(eligible.email),
        repository.requestPasswordRecovery(eligible.email.toUpperCase()),
        repository.requestPasswordRecovery("missing@example.test"),
        repository.requestPasswordRecovery(unverified.email),
        repository.requestPasswordRecovery(disabled.email),
        repository.requestPasswordRecovery(deleted.email),
      ]);
      assert.equal(await prisma.notificationOutbox.count({ where: { kind: "PASSWORD_RECOVERY", userId: eligible.id } }), 1);
      assert.equal(await prisma.notificationOutbox.count({ where: { kind: "PASSWORD_RECOVERY", userId: { in: [unverified.id, disabled.id, deleted.id] } } }), 0);
      const afterRequest = await prisma.user.findUniqueOrThrow({ where: { id: eligible.id } });
      assert.equal(afterRequest.credentialVersion, before.credentialVersion);
      assert.equal(afterRequest.passwordHash, before.passwordHash);
      assert.equal(await prisma.identitySession.count({ where: { userId: eligible.id } }), 0);

      assert.equal(await worker.processOne(new Date(Date.now() + 5)), true);
      const recoveryDelivery = delivered.find((delivery) => "recoveryUrl" in delivery);
      assert.ok(recoveryDelivery);
      const deliveredToken = new URL(recoveryDelivery.recoveryUrl).hash.slice("#token=".length);
      assert.equal(deliveredToken.length, 43);
      const stored = await prisma.passwordRecoveryToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(deliveredToken) } });
      assert.equal(stored.credentialVersionSnapshot, eligible.credentialVersion);
      assert.equal(stored.emailVerificationVersionSnapshot, eligible.emailVerificationVersion);
      assert.equal(Object.hasOwn(stored, "rawToken"), false);
      const recoveryOutbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { kind: "PASSWORD_RECOVERY", userId: eligible.id } });
      assert.equal(recoveryOutbox.status, "SENT");
      assert.equal(recoveryOutbox.destinationAddress, null);

      await createSession(eligible);
      await createSession(eligible);
      const sibling = await createRecoveryToken(eligible);
      const oldHash = (await prisma.user.findUniqueOrThrow({ where: { id: eligible.id } })).passwordHash;
      const newPassword = "first reset winner password is long enough";
      await service.reset(deliveredToken, newPassword);
      const resetUser = await prisma.user.findUniqueOrThrow({ where: { id: eligible.id } });
      assert.equal(await argon2.verify(resetUser.passwordHash, CURRENT_PASSWORD), false);
      assert.equal(await argon2.verify(resetUser.passwordHash, newPassword), true);
      assert.notEqual(resetUser.passwordHash, oldHash);
      assert.equal(resetUser.credentialVersion, 2);
      assert.ok((await prisma.passwordRecoveryToken.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt);
      assert.ok((await prisma.passwordRecoveryToken.findUniqueOrThrow({ where: { id: sibling.stored.id } })).invalidatedAt);
      assert.equal(await prisma.identitySession.count({ where: { userId: eligible.id, revokedAt: null } }), 0);
      const resetAudit = await prisma.identityAuditLog.findFirstOrThrow({
        where: { action: "PASSWORD_RESET_COMPLETED", targetUserId: eligible.id },
      });
      assert.equal(resetAudit.actorUserId, null);
      assert.equal(JSON.stringify(resetAudit).includes(deliveredToken), false);
      assert.equal(JSON.stringify(resetAudit).includes(newPassword), false);
      const completionOutbox = await prisma.notificationOutbox.findFirstOrThrow({
        where: { kind: "PASSWORD_RESET_COMPLETED", userId: eligible.id },
      });
      assert.equal(completionOutbox.destinationAddress, eligible.email);
      assert.equal(JSON.stringify(completionOutbox).includes(deliveredToken), false);
      await assert.rejects(() => service.reset(deliveredToken, "replay password long enough"), PasswordRecoveryTokenInvalidError);
      assert.equal(await worker.processOne(new Date(Date.now() + 5)), true);
      const completionDelivery = delivered.find((delivery) => !("recoveryUrl" in delivery));
      assert.deepEqual(completionDelivery, { destinationAddress: eligible.email });

      const staleCredential = await verifyUser(await createUser("stale-credential"));
      const staleCredentialToken = await createRecoveryToken(staleCredential);
      const changedHash = await argon2.hash("changed password invalidates recovery links", { type: argon2.argon2id });
      await authRepository.changePassword({
        userId: staleCredential.id,
        expectedCredentialVersion: staleCredential.credentialVersion,
        passwordHash: changedHash,
      });
      await assert.rejects(
        () => service.reset(staleCredentialToken.rawToken, "stale credential reset password long enough"),
        PasswordRecoveryTokenInvalidError,
      );

      const staleEmail = await verifyUser(await createUser("stale-email"));
      const staleEmailToken = await createRecoveryToken(staleEmail);
      await changeEmailGeneration(staleEmail, "stale-email-new");
      await assert.rejects(
        () => service.reset(staleEmailToken.rawToken, "stale email reset password long enough"),
        PasswordRecoveryTokenInvalidError,
      );

      const expired = await verifyUser(await createUser("expired"));
      const expiredToken = await createRecoveryToken(expired, makeOpaqueToken(), { expiresAt: new Date(Date.now() - 1) });
      await assert.rejects(
        () => service.reset(expiredToken.rawToken, "expired reset password is long enough"),
        PasswordRecoveryTokenInvalidError,
      );

      const sameTokenUser = await verifyUser(await createUser("same-token"));
      const sameToken = await createRecoveryToken(sameTokenUser);
      const sameTokenResults = await Promise.allSettled([
        service.reset(sameToken.rawToken, "same token first password long enough"),
        service.reset(sameToken.rawToken, "same token second password long enough"),
      ]);
      assert.equal(sameTokenResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(sameTokenResults.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: sameTokenUser.id } })).credentialVersion, 2);
      assert.equal(await prisma.identityAuditLog.count({ where: { action: "PASSWORD_RESET_COMPLETED", targetUserId: sameTokenUser.id } }), 1);

      const twoTokenUser = await verifyUser(await createUser("two-token"));
      const tokenA = await createRecoveryToken(twoTokenUser);
      const tokenB = await createRecoveryToken(twoTokenUser);
      const twoTokenResults = await Promise.allSettled([
        service.reset(tokenA.rawToken, "two token first password long enough"),
        service.reset(tokenB.rawToken, "two token second password long enough"),
      ]);
      assert.equal(twoTokenResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(twoTokenResults.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: twoTokenUser.id } })).credentialVersion, 2);

      const raceUser = await verifyUser(await createUser("password-change-race"));
      const raceToken = await createRecoveryToken(raceUser);
      const normalChange = new ChangePasswordUseCase(authRepository).execute({
        userId: raceUser.id,
        currentPassword: CURRENT_PASSWORD,
        newPassword: "normal change race password long enough",
      });
      const recoveryChange = service.reset(raceToken.rawToken, "recovery change race password long enough");
      const raceResults = await Promise.allSettled([normalChange, recoveryChange]);
      assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: raceUser.id } })).credentialVersion, 2);

      const lifecycleUser = await verifyUser(await createUser("lifecycle-race"));
      const lifecycleToken = await createRecoveryToken(lifecycleUser);
      const lifecycleResults = await Promise.allSettled([
        service.reset(lifecycleToken.rawToken, "lifecycle reset password long enough"),
        prisma.user.update({ where: { id: lifecycleUser.id }, data: { status: "DISABLED" } }),
      ]);
      assert.equal(lifecycleResults.filter((result) => result.status === "fulfilled").length >= 1, true);
      const lifecycleCurrent = await prisma.user.findUniqueOrThrow({ where: { id: lifecycleUser.id } });
      assert.equal(lifecycleCurrent.status, "DISABLED");
      assert.equal(await prisma.identitySession.count({ where: { userId: lifecycleUser.id, revokedAt: null } }), 0);

      async function assertForcedRollback(label, triggerSql) {
        const user = await verifyUser(await createUser(`rollback-${label}`));
        const recovery = await createRecoveryToken(user);
        await createSession(user);
        const functionName = `pr004i_${label}_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$
          BEGIN
            RAISE EXCEPTION 'forced ${label} failure';
          END;
          $$ LANGUAGE plpgsql;
        `);
        await prisma.$executeRawUnsafe(triggerSql(functionName, triggerName));
        try {
          await assert.rejects(() => service.reset(recovery.rawToken, `rollback ${label} password is long enough`));
          const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
          const token = await prisma.passwordRecoveryToken.findUniqueOrThrow({ where: { id: recovery.stored.id } });
          assert.equal(current.credentialVersion, 1);
          assert.equal(token.consumedAt, null);
          assert.equal(token.invalidatedAt, null);
          assert.equal(await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }), 1);
          assert.equal(await prisma.identityAuditLog.count({ where: { action: "PASSWORD_RESET_COMPLETED", targetUserId: user.id } }), 0);
          assert.equal(await prisma.notificationOutbox.count({ where: { kind: "PASSWORD_RESET_COMPLETED", userId: user.id } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON ${label === "audit" ? '"IdentityAuditLog"' : label === "session" ? '"IdentitySession"' : label === "token" ? '"PasswordRecoveryToken"' : '"NotificationOutbox"'};`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }
      }

      await assertForcedRollback(
        "audit",
        (functionName, triggerName) => `
          CREATE TRIGGER "${triggerName}"
          BEFORE INSERT ON "IdentityAuditLog"
          FOR EACH ROW
          WHEN (NEW."action" = 'PASSWORD_RESET_COMPLETED'::"IdentityAuditAction")
          EXECUTE FUNCTION "${functionName}"();
        `,
      );
      await assertForcedRollback(
        "session",
        (functionName, triggerName) => `
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE OF "revokedAt" ON "IdentitySession"
          FOR EACH ROW
          WHEN (NEW."revokedAt" IS NOT NULL)
          EXECUTE FUNCTION "${functionName}"();
        `,
      );
      await assertForcedRollback(
        "token",
        (functionName, triggerName) => `
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE OF "consumedAt" ON "PasswordRecoveryToken"
          FOR EACH ROW
          WHEN (NEW."consumedAt" IS NOT NULL)
          EXECUTE FUNCTION "${functionName}"();
        `,
      );
      await assertForcedRollback(
        "outbox",
        (functionName, triggerName) => `
          CREATE TRIGGER "${triggerName}"
          BEFORE INSERT ON "NotificationOutbox"
          FOR EACH ROW
          WHEN (NEW."kind" = 'PASSWORD_RESET_COMPLETED'::"NotificationOutboxKind")
          EXECUTE FUNCTION "${functionName}"();
        `,
      );
    } finally {
      await prisma.identityAuditLog.deleteMany({ where: { targetUserId: { in: userIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordRecoveryToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.identitySession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });
}
