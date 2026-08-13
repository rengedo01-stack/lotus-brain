const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.RECOVERY_CHANNEL_DATABASE_URL;

if (databaseUrl === undefined) {
  test("recovery-channel real database proof is opt-in", { skip: "RECOVERY_CHANNEL_DATABASE_URL is not set" }, () => {});
} else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { hashSecret, makeOpaqueToken } = require("../dist/modules/auth/auth.utils.js");
  const { EmailVerificationService } = require("../dist/modules/notification/application/email-verification.service.js");
  const { NotificationOutboxWorker } = require("../dist/modules/notification/application/notification-outbox.worker.js");
  const { EmailVerificationTokenInvalidError } = require("../dist/modules/notification/application/recovery-channel.errors.js");
  const { PrismaRecoveryChannelRepository } = require("../dist/modules/notification/infrastructure/prisma-recovery-channel.repository.js");

  test("recovery-channel migration, token lifecycle, and concurrent outbox claims hold in PostgreSQL", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const repository = new PrismaRecoveryChannelRepository(prisma);
    const service = new EmailVerificationService(repository);
    const fixture = `pr004h-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userIds = [];
    const delivered = [];
    const worker = new NotificationOutboxWorker(
      repository,
      { async sendEmailVerification(delivery) { delivered.push(delivery); } },
      { get: () => "https://trusted.example.test" },
    );

    async function createUser(label, overrides = {}) {
      const user = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-004H ${label}`,
          passwordHash: "not-used-by-this-proof",
          ...overrides,
        },
      });
      userIds.push(user.id);
      return user;
    }

    async function createToken(user, rawToken, expiresAt = new Date(Date.now() + 60_000)) {
      return prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(rawToken),
          emailVersionSnapshot: user.emailVerificationVersion,
          expiresAt,
        },
      });
    }

    try {
      const systemAdminRole = await prisma.role.findUnique({ where: { code: "SYSTEM_ADMIN" } });
      assert.ok(systemAdminRole);
      const systemAdmin = await createUser("system-admin");
      await prisma.userRole.create({ data: { userId: systemAdmin.id, roleId: systemAdminRole.id } });
      assert.equal(systemAdmin.emailVerifiedAt, null);
      assert.equal(systemAdmin.emailVerificationVersion, 1);

      await prisma.user.update({
        where: { id: systemAdmin.id },
        data: { emailVerifiedAt: new Date() },
      });
      await assert.rejects(
        () => prisma.user.update({
          where: { id: systemAdmin.id },
          data: { emailVerificationVersion: 2 },
        }),
      );
      const changed = await prisma.user.update({
        where: { id: systemAdmin.id },
        data: {
          email: `${fixture}-system-admin-new@example.test`,
          emailVerifiedAt: null,
          emailVerificationVersion: 2,
        },
      });
      assert.equal(changed.emailVerifiedAt, null);
      assert.equal(changed.emailVerificationVersion, 2);

      const active = await createUser("active");
      const before = await prisma.user.findUniqueOrThrow({ where: { id: active.id } });
      assert.equal(await prisma.identitySession.count({ where: { userId: active.id } }), 0);
      await repository.requestEmailVerification(active.id);
      await repository.requestEmailVerification(active.id);
      assert.equal(await prisma.notificationOutbox.count({ where: { userId: active.id } }), 1);
      const pending = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId: active.id } });
      assert.equal(pending.destinationAddress, active.email);
      assert.equal(pending.emailVersionSnapshot, 1);
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: active.id } });
      assert.equal(unchanged.credentialVersion, before.credentialVersion);
      assert.equal(unchanged.lastLoginAt, before.lastLoginAt);
      assert.equal(await prisma.identitySession.count({ where: { userId: active.id } }), 0);

      assert.equal(await worker.processOne(new Date(Date.now() + 5)), true);
      assert.equal(delivered.length, 1);
      const rawToken = new URL(delivered[0].verificationUrl).hash.slice("#token=".length);
      assert.equal(rawToken.length, 43);
      const stored = await prisma.emailVerificationToken.findUniqueOrThrow({
        where: { tokenHash: hashSecret(rawToken) },
      });
      assert.equal(stored.tokenHash, hashSecret(rawToken));
      assert.equal(Object.hasOwn(stored, "rawToken"), false);
      const sent = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: pending.id } });
      assert.equal(sent.status, "SENT");
      assert.equal(sent.destinationAddress, null);

      const siblingRawToken = makeOpaqueToken();
      const sibling = await createToken(active, siblingRawToken);
      await service.confirm(rawToken);
      const verified = await prisma.user.findUniqueOrThrow({ where: { id: active.id } });
      assert.ok(verified.emailVerifiedAt);
      assert.ok((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt);
      assert.ok((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: sibling.id } })).invalidatedAt);
      const audit = await prisma.identityAuditLog.findFirstOrThrow({
        where: { action: "EMAIL_VERIFIED", targetUserId: active.id },
      });
      assert.equal(audit.actorUserId, null);
      await assert.rejects(() => service.confirm(rawToken), EmailVerificationTokenInvalidError);

      const expired = await createUser("expired");
      const expiredRawToken = makeOpaqueToken();
      await createToken(expired, expiredRawToken, new Date(Date.now() - 1));
      await assert.rejects(() => service.confirm(expiredRawToken), EmailVerificationTokenInvalidError);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: expired.id } })).emailVerifiedAt, null);

      const stale = await createUser("stale");
      const staleRawToken = makeOpaqueToken();
      await createToken(stale, staleRawToken);
      await prisma.user.update({
        where: { id: stale.id },
        data: {
          email: `${fixture}-stale-new@example.test`,
          emailVerifiedAt: null,
          emailVerificationVersion: 2,
        },
      });
      await assert.rejects(() => service.confirm(staleRawToken), EmailVerificationTokenInvalidError);

      const concurrent = await createUser("concurrent");
      const rawA = makeOpaqueToken();
      const rawB = makeOpaqueToken();
      await Promise.all([createToken(concurrent, rawA), createToken(concurrent, rawB)]);
      const confirmations = await Promise.allSettled([service.confirm(rawA), service.confirm(rawB)]);
      assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(confirmations.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await prisma.identityAuditLog.count({
        where: { action: "EMAIL_VERIFIED", targetUserId: concurrent.id },
      }), 1);

      const lease = await createUser("lease");
      await repository.requestEmailVerification(lease.id);
      const now = new Date();
      const firstClaim = await repository.claimDueEmailVerification("worker-a", now, new Date(now.getTime() + 1_000));
      assert.ok(firstClaim);
      const parallelClaim = await repository.claimDueEmailVerification("worker-b", now, new Date(now.getTime() + 1_000));
      assert.equal(parallelClaim, null);
      const recoveredClaim = await repository.claimDueEmailVerification("worker-b", new Date(now.getTime() + 1_001), new Date(now.getTime() + 2_000));
      assert.equal(recoveredClaim.id, firstClaim.id);
    } finally {
      await prisma.identityAuditLog.deleteMany({ where: { targetUserId: { in: userIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.identitySession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });
}
