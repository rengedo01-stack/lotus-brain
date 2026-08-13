const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.USER_INVITATION_DATABASE_URL;

if (databaseUrl === undefined) {
  test("user-invitation real database proof is opt-in", { skip: "USER_INVITATION_DATABASE_URL is not set" }, () => {});
} else {
  const argon2 = require("argon2");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { LoginUseCase } = require("../dist/modules/auth/application/auth.use-cases.js");
  const { PrismaAuthRepository } = require("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
  const { makeOpaqueToken, hashSecret } = require("../dist/modules/auth/auth.utils.js");
  const { UserInvitationService } = require("../dist/modules/identity/application/user-invitation.service.js");
  const { NotificationOutboxWorker } = require("../dist/modules/notification/application/notification-outbox.worker.js");
  const { UserInvitationCredentialInvalidError } = require("../dist/modules/notification/application/user-invitation.errors.js");
  const { PrismaRecoveryChannelRepository } = require("../dist/modules/notification/infrastructure/prisma-recovery-channel.repository.js");
  const { PrismaUserInvitationRepository } = require("../dist/modules/notification/infrastructure/prisma-user-invitation.repository.js");

  const PASSWORD = "a valid invitation password is long enough";

  test("invitation-only onboarding preserves PostgreSQL lifecycle, atomicity, and concurrency invariants", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const invitationRepository = new PrismaUserInvitationRepository(prisma);
    const service = new UserInvitationService(invitationRepository);
    const recoveryRepository = new PrismaRecoveryChannelRepository(prisma);
    const fixture = `pr004j-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdUserIds = [];
    const invitationIds = [];
    const deliveries = [];
    const worker = new NotificationOutboxWorker(
      recoveryRepository,
      {
        async sendEmailVerification() { throw new Error("not expected"); },
        async sendPasswordRecovery() { throw new Error("not expected"); },
        async sendPasswordResetCompleted() { throw new Error("not expected"); },
        async sendUserInvitation(delivery) { deliveries.push(delivery); },
      },
      { get: () => "https://trusted.example.test" },
      invitationRepository,
    );

    async function createUser(label, overrides = {}) {
      const user = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-004J ${label}`,
          passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
          ...overrides,
        },
      });
      createdUserIds.push(user.id);
      return user;
    }

    async function createInvitation(label) {
      const invitation = await service.createInvitation(admin.id, `${fixture}-${label}@example.test`);
      invitationIds.push(invitation.id);
      return invitation;
    }

    async function deliverInvitation() {
      const before = deliveries.length;
      assert.equal(await worker.processOne(new Date(Date.now() + 5)), true);
      assert.equal(deliveries.length, before + 1);
      const delivery = deliveries.at(-1);
      const url = new URL(delivery.invitationUrl);
      assert.equal(url.origin, "https://trusted.example.test");
      assert.equal(url.pathname, "/accept-invitation");
      const rawToken = url.hash.slice("#token=".length);
      assert.equal(rawToken.length, 43);
      return { delivery, rawToken };
    }

    const admin = await createUser("admin");

    try {
      await assert.rejects(() => prisma.user.create({
        data: {
          email: `${fixture}-direct-verified@example.test`,
          displayName: "Direct verified insert",
          passwordHash: "not-an-invitation-credential",
          emailVerifiedAt: new Date(),
        },
      }));

      const invitation = await service.createInvitation(admin.id, ` ${fixture}-accepted@EXAMPLE.TEST `);
      invitationIds.push(invitation.id);
      assert.equal(invitation.email, `${fixture}-accepted@example.test`);
      assert.equal(await prisma.user.count({ where: { email: invitation.email } }), 0);
      const queued = await prisma.notificationOutbox.findFirstOrThrow({ where: { invitationId: invitation.id } });
      assert.equal(queued.kind, "USER_INVITATION");
      assert.equal(queued.userId, null);
      assert.equal(queued.emailVersionSnapshot, null);
      assert.equal(queued.destinationAddress, invitation.email);
      const createAudit = await prisma.identityAuditLog.findFirstOrThrow({ where: { action: "USER_INVITATION_CREATED", actorUserId: admin.id } });
      assert.equal(createAudit.targetUserId, null);
      assert.equal(JSON.stringify(createAudit).includes("rawToken"), false);
      await assert.rejects(() => prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }));

      const { rawToken } = await deliverInvitation();
      const stored = await prisma.userInvitationToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(rawToken) } });
      assert.equal(stored.tokenHash, hashSecret(rawToken));
      assert.equal(Object.hasOwn(stored, "rawToken"), false);
      await assert.rejects(() => prisma.userInvitationToken.update({
        where: { id: stored.id },
        data: { consumedAt: new Date(), invalidatedAt: new Date() },
      }));
      assert.equal((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: queued.id } })).destinationAddress, null);
      assert.equal(await prisma.identitySession.count({ where: { userId: { in: createdUserIds } } }), 0);

      await service.acceptInvitation(rawToken, PASSWORD);
      const accepted = await prisma.user.findUniqueOrThrow({ where: { email: invitation.email } });
      createdUserIds.push(accepted.id);
      assert.equal(accepted.status, "ACTIVE");
      assert.ok(accepted.emailVerifiedAt);
      assert.equal(accepted.credentialVersion, 1);
      assert.equal(accepted.emailVerificationVersion, 1);
      assert.equal(accepted.displayName, accepted.email);
      assert.equal(await argon2.verify(accepted.passwordHash, PASSWORD), true);
      assert.equal(await prisma.userRole.count({ where: { userId: accepted.id } }), 0);
      assert.equal(await prisma.identitySession.count({ where: { userId: accepted.id } }), 0);
      assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status, "ACCEPTED");
      assert.ok((await prisma.userInvitationToken.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt);
      const acceptAudit = await prisma.identityAuditLog.findFirstOrThrow({ where: { action: "USER_INVITATION_ACCEPTED", targetUserId: accepted.id } });
      assert.equal(acceptAudit.actorUserId, null);
      assert.equal(JSON.stringify(acceptAudit).includes(rawToken), false);
      assert.equal(JSON.stringify(acceptAudit).includes(PASSWORD), false);
      assert.equal(JSON.stringify(queued).includes(rawToken), false);
      await assert.rejects(() => service.acceptInvitation(rawToken, PASSWORD), UserInvitationCredentialInvalidError);

      const login = await new LoginUseCase(new PrismaAuthRepository(prisma)).execute({
        email: accepted.email,
        password: PASSWORD,
      });
      assert.equal(login.user.id, accepted.id);
      assert.equal(await prisma.identitySession.count({ where: { userId: accepted.id } }), 1);

      const resend = await createInvitation("resend");
      const firstResend = await deliverInvitation();
      const firstOutbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { invitationId: resend.id } });
      await prisma.notificationOutbox.update({ where: { id: firstOutbox.id }, data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
      await service.resendInvitation(resend.id, admin.id);
      assert.equal((await prisma.userInvitationToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(firstResend.rawToken) } })).invalidatedAt, null);
      const secondResend = await deliverInvitation();
      await service.acceptInvitation(secondResend.rawToken, PASSWORD);
      assert.ok((await prisma.userInvitationToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(firstResend.rawToken) } })).invalidatedAt);
      await assert.rejects(() => service.acceptInvitation(firstResend.rawToken, PASSWORD), UserInvitationCredentialInvalidError);
      const resentUser = await prisma.user.findUniqueOrThrow({ where: { email: resend.email } });
      createdUserIds.push(resentUser.id);

      const cancelled = await createInvitation("cancelled");
      const cancelledDelivery = await deliverInvitation();
      const cancelledToken = await prisma.userInvitationToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(cancelledDelivery.rawToken) } });
      await service.cancelInvitation(cancelled.id, admin.id);
      assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: cancelled.id } })).status, "CANCELLED");
      assert.ok((await prisma.userInvitationToken.findUniqueOrThrow({ where: { id: cancelledToken.id } })).invalidatedAt);
      assert.equal(await prisma.notificationOutbox.count({ where: { invitationId: cancelled.id, status: { in: ["PENDING", "PROCESSING"] } } }), 0);
      await assert.rejects(() => service.acceptInvitation(cancelledDelivery.rawToken, PASSWORD), UserInvitationCredentialInvalidError);
      assert.equal(await prisma.user.count({ where: { email: cancelled.email } }), 0);

      const same = await createInvitation("same-token");
      const sameDelivery = await deliverInvitation();
      const sameResults = await Promise.allSettled([
        service.acceptInvitation(sameDelivery.rawToken, PASSWORD),
        service.acceptInvitation(sameDelivery.rawToken, PASSWORD),
      ]);
      assert.equal(sameResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(sameResults.filter((result) => result.status === "rejected").length, 1);
      const sameUser = await prisma.user.findUniqueOrThrow({ where: { email: same.email } });
      createdUserIds.push(sameUser.id);
      assert.equal(await prisma.identityAuditLog.count({ where: { action: "USER_INVITATION_ACCEPTED", targetUserId: sameUser.id } }), 1);

      const different = await createInvitation("different-token");
      const rawA = makeOpaqueToken();
      const rawB = makeOpaqueToken();
      const [tokenA, tokenB] = await Promise.all([
        prisma.userInvitationToken.create({ data: { invitationId: different.id, tokenHash: hashSecret(rawA), expiresAt: new Date(Date.now() + 60_000) } }),
        prisma.userInvitationToken.create({ data: { invitationId: different.id, tokenHash: hashSecret(rawB), expiresAt: new Date(Date.now() + 60_000) } }),
      ]);
      const differentResults = await Promise.allSettled([
        service.acceptInvitation(rawA, PASSWORD),
        service.acceptInvitation(rawB, PASSWORD),
      ]);
      assert.equal(differentResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(differentResults.filter((result) => result.status === "rejected").length, 1);
      const differentUser = await prisma.user.findUniqueOrThrow({ where: { email: different.email } });
      createdUserIds.push(differentUser.id);
      const differentTokens = await prisma.userInvitationToken.findMany({ where: { id: { in: [tokenA.id, tokenB.id] } } });
      assert.equal(differentTokens.filter((entry) => entry.consumedAt !== null).length, 1);
      assert.equal(differentTokens.filter((entry) => entry.invalidatedAt !== null).length, 1);

      const duplicateEmail = `${fixture}-duplicate@example.test`;
      const duplicateResults = await Promise.allSettled([
        service.createInvitation(admin.id, duplicateEmail),
        service.createInvitation(admin.id, duplicateEmail),
      ]);
      assert.equal(duplicateResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(duplicateResults.filter((result) => result.status === "rejected").length, 1);
      const duplicateInvitation = await prisma.userInvitation.findFirstOrThrow({ where: { email: duplicateEmail, status: "PENDING" } });
      invitationIds.push(duplicateInvitation.id);
      await service.cancelInvitation(duplicateInvitation.id, admin.id);

      const expired = await createInvitation("expired-token");
      const expiredRaw = makeOpaqueToken();
      await prisma.userInvitationToken.create({
        data: { invitationId: expired.id, tokenHash: hashSecret(expiredRaw), expiresAt: new Date(Date.now() - 1) },
      });
      await assert.rejects(() => service.acceptInvitation(expiredRaw, PASSWORD), UserInvitationCredentialInvalidError);
      assert.equal(await prisma.user.count({ where: { email: expired.email } }), 0);
      await service.cancelInvitation(expired.id, admin.id);

      const preSendUser = await createInvitation("pre-send-user");
      await createUser("pre-send-existing", { email: preSendUser.email });
      const deliveriesBeforePreSend = deliveries.length;
      assert.equal(await worker.processOne(new Date(Date.now() + 5)), true);
      assert.equal(deliveries.length, deliveriesBeforePreSend);
      assert.equal(await prisma.userInvitationToken.count({ where: { invitationId: preSendUser.id } }), 0);
      assert.equal((await prisma.notificationOutbox.findFirstOrThrow({ where: { invitationId: preSendUser.id } })).status, "CANCELLED");

      const ambiguous = await createInvitation("ambiguous-retry");
      const ambiguousDeliveries = [];
      let deliveryAttempts = 0;
      const ambiguousWorker = new NotificationOutboxWorker(
        recoveryRepository,
        {
          async sendEmailVerification() { throw new Error("not expected"); },
          async sendPasswordRecovery() { throw new Error("not expected"); },
          async sendPasswordResetCompleted() { throw new Error("not expected"); },
          async sendUserInvitation(delivery) {
            ambiguousDeliveries.push(delivery);
            deliveryAttempts += 1;
            if (deliveryAttempts === 1) throw new Error("ambiguous SMTP result");
          },
        },
        { get: () => "https://trusted.example.test" },
        invitationRepository,
      );
      assert.equal(await ambiguousWorker.processOne(new Date()), true);
      assert.equal(await ambiguousWorker.processOne(new Date(Date.now() + 10_000)), true);
      assert.equal(ambiguousDeliveries.length, 2);
      const ambiguousRawTokens = ambiguousDeliveries.map((delivery) => new URL(delivery.invitationUrl).hash.slice("#token=".length));
      assert.notEqual(ambiguousRawTokens[0], ambiguousRawTokens[1]);
      const ambiguousTokens = await prisma.userInvitationToken.findMany({ where: { invitationId: ambiguous.id } });
      assert.equal(ambiguousTokens.length, 2);
      assert.equal(ambiguousTokens.every((entry) => entry.invalidatedAt === null), true);
      await service.acceptInvitation(ambiguousRawTokens[1], PASSWORD);
      const afterAmbiguousAccept = await prisma.userInvitationToken.findMany({ where: { invitationId: ambiguous.id } });
      assert.equal(afterAmbiguousAccept.filter((entry) => entry.consumedAt !== null).length, 1);
      assert.equal(afterAmbiguousAccept.filter((entry) => entry.invalidatedAt !== null).length, 1);
      const ambiguousUser = await prisma.user.findUniqueOrThrow({ where: { email: ambiguous.email } });
      createdUserIds.push(ambiguousUser.id);

      const resendRace = await createInvitation("accept-resend-race");
      const resendRaceDelivery = await deliverInvitation();
      const resendRaceOutbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { invitationId: resendRace.id } });
      await prisma.notificationOutbox.update({
        where: { id: resendRaceOutbox.id },
        data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      });
      const resendRaceResults = await Promise.allSettled([
        service.acceptInvitation(resendRaceDelivery.rawToken, PASSWORD),
        service.resendInvitation(resendRace.id, admin.id),
      ]);
      assert.equal(resendRaceResults[0].status, "fulfilled");
      assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: resendRace.id } })).status, "ACCEPTED");
      assert.equal(await prisma.notificationOutbox.count({
        where: { invitationId: resendRace.id, status: { in: ["PENDING", "PROCESSING"] } },
      }), 0);
      const resendRaceUser = await prisma.user.findUniqueOrThrow({ where: { email: resendRace.email } });
      createdUserIds.push(resendRaceUser.id);

      const race = await createInvitation("cancel-race");
      const raceDelivery = await deliverInvitation();
      const raceResults = await Promise.allSettled([
        service.acceptInvitation(raceDelivery.rawToken, PASSWORD),
        service.cancelInvitation(race.id, admin.id),
      ]);
      assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
      const raceState = await prisma.userInvitation.findUniqueOrThrow({ where: { id: race.id } });
      assert.ok(["ACCEPTED", "CANCELLED"].includes(raceState.status));
      const raceUser = await prisma.user.findUnique({ where: { email: race.email } });
      if (raceState.status === "ACCEPTED") {
        assert.ok(raceUser);
        createdUserIds.push(raceUser.id);
      } else {
        assert.equal(raceUser, null);
      }

      const collisionUser = await createUser("existing");
      await assert.rejects(
        () => service.createInvitation(admin.id, collisionUser.email),
        /identity already exists/i,
      );
      const deletedCollision = await createUser("deleted");
      await prisma.user.update({ where: { id: deletedCollision.id }, data: { deletedAt: new Date() } });
      await assert.rejects(
        () => service.createInvitation(admin.id, deletedCollision.email),
        /identity already exists/i,
      );

      const competing = await createInvitation("competing-user");
      const competingDelivery = await deliverInvitation();
      const externallyCreated = await createUser("competing-external", { email: competing.email });
      assert.equal(externallyCreated.email, competing.email);
      await assert.rejects(() => service.acceptInvitation(competingDelivery.rawToken, PASSWORD), UserInvitationCredentialInvalidError);
      assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: competing.id } })).status, "PENDING");

      const lease = await createInvitation("lease");
      const now = new Date();
      const firstClaim = await invitationRepository.claimDueUserInvitation("worker-a", now, new Date(now.getTime() + 1_000));
      assert.ok(firstClaim);
      const parallelClaim = await invitationRepository.claimDueUserInvitation("worker-b", now, new Date(now.getTime() + 1_000));
      assert.equal(parallelClaim, null);
      const recoveredClaim = await invitationRepository.claimDueUserInvitation("worker-b", new Date(now.getTime() + 1_001), new Date(now.getTime() + 2_000));
      assert.equal(recoveredClaim.id, firstClaim.id);
      await invitationRepository.markUserInvitationFailed(recoveredClaim, "worker-b", new Date(), "TEST", null);

      const rollback = await createInvitation("rollback-audit");
      const rollbackDelivery = await deliverInvitation();
      const rollbackToken = await prisma.userInvitationToken.findUniqueOrThrow({ where: { tokenHash: hashSecret(rollbackDelivery.rawToken) } });
      const functionName = `pr004j_rollback_${Date.now()}`;
      const triggerName = `${functionName}_trigger`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$
        BEGIN RAISE EXCEPTION 'forced invitation audit failure'; END;
        $$ LANGUAGE plpgsql;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "IdentityAuditLog"
        FOR EACH ROW
        WHEN (NEW."action" = 'USER_INVITATION_ACCEPTED'::"IdentityAuditAction")
        EXECUTE FUNCTION "${functionName}"();
      `);
      try {
        await assert.rejects(() => service.acceptInvitation(rollbackDelivery.rawToken, PASSWORD));
        assert.equal(await prisma.user.count({ where: { email: rollback.email } }), 0);
        assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: rollback.id } })).status, "PENDING");
        const unchangedToken = await prisma.userInvitationToken.findUniqueOrThrow({ where: { id: rollbackToken.id } });
        assert.equal(unchangedToken.consumedAt, null);
        assert.equal(unchangedToken.invalidatedAt, null);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "IdentityAuditLog";`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
      }
    } finally {
      await prisma.identityAuditLog.deleteMany({
        where: { OR: [{ actorUserId: admin.id }, { targetUserId: { in: createdUserIds } }] },
      });
      await prisma.notificationOutbox.deleteMany({ where: { invitationId: { in: invitationIds } } });
      await prisma.userInvitationToken.deleteMany({ where: { invitationId: { in: invitationIds } } });
      await prisma.userInvitation.deleteMany({ where: { id: { in: invitationIds } } });
      await prisma.notificationOutbox.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.passwordRecoveryToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.identitySession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.$disconnect();
    }
  });
}
