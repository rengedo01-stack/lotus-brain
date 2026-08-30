const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.PASSKEY_MFA_DATABASE_URL;

if (databaseUrl === undefined) {
  test("passkey MFA real database proof is opt-in", { skip: "PASSKEY_MFA_DATABASE_URL is not set" }, () => {});
} else {
  const argon2 = require("argon2");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { hashSecret, makeOpaqueToken } = require("../dist/modules/auth/auth.utils.js");
  const { PrismaPasskeyMfaRepository } = require("../dist/modules/auth/infrastructure/prisma-passkey-mfa.repository.js");
  const { PrismaRecoveryChannelRepository } = require("../dist/modules/notification/infrastructure/prisma-recovery-channel.repository.js");

  test("passkey MFA PostgreSQL proof preserves policy, pre-auth, replay, recovery, and DB invariants", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const mfa = new PrismaPasskeyMfaRepository(prisma);
    const recovery = new PrismaRecoveryChannelRepository(prisma);
    const fixture = `pr004l-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userIds = [];

    async function createUser(label, overrides = {}) {
      const user = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-004L ${label}`,
          passwordHash: await argon2.hash("pr004l current password is long enough", { type: argon2.argon2id }),
          ...overrides,
        },
      });
      userIds.push(user.id);
      return prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }

    async function createCredential(user, label) {
      return prisma.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId: `${fixture}-${label}-credential`,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          counter: 0n,
          transports: ["internal"],
        },
      });
    }

    async function createSession(user, suffix, overrides = {}) {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      return prisma.identitySession.create({
        data: {
          userId: user.id,
          tokenHash: `${fixture}-${suffix}-token`,
          csrfTokenHash: `${fixture}-${suffix}-csrf`,
          credentialVersion: current.credentialVersion,
          authenticationPolicyVersion: current.authenticationPolicyVersion,
          expiresAt: new Date(Date.now() + 60_000),
          activatedAt: new Date(),
          ...overrides,
        },
      });
    }

    try {
      const user = await createUser("mfa");
      const credential = await createCredential(user, "mfa");
      const oldSession = await createSession(user, "old");
      const pendingBeforeEnable = await createSession(user, "pending-before-enable", { activatedAt: null });

      const stepUpHash = hashSecret(makeOpaqueToken());
      await mfa.beginStepUp({
        userId: user.id,
        identitySessionId: oldSession.id,
        purpose: "ENABLE_MFA",
        expectedCredentialVersion: user.credentialVersion,
        expectedAuthenticationPolicyVersion: user.authenticationPolicyVersion,
        challengeHash: stepUpHash,
      });
      const stepClaim = await mfa.claimStepUp({
        userId: user.id,
        identitySessionId: oldSession.id,
        purpose: "ENABLE_MFA",
        challengeHash: stepUpHash,
        credentialId: credential.credentialId,
      });
      await mfa.completeStepUp({
        userId: user.id,
        identitySessionId: oldSession.id,
        purpose: "ENABLE_MFA",
        challengeId: stepClaim.ceremonyId,
        credentialId: stepClaim.credential.id,
        expectedCounter: stepClaim.credential.counter,
        newCounter: 0n,
      });
      const enabled = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.ok(enabled.passkeyMfaEnabledAt);
      assert.equal(enabled.authenticationPolicyVersion, 2);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: oldSession.id } })).revokedAt);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: pendingBeforeEnable.id } })).revokedAt);
      assert.equal(await prisma.identityAuditLog.count({ where: { action: "PASSKEY_MFA_ENABLED", targetUserId: user.id } }), 1);
      assert.equal(await prisma.notificationOutbox.count({ where: { kind: "PASSKEY_MFA_ENABLED", userId: user.id } }), 1);

      await assert.rejects(
        () => prisma.webAuthnCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } }),
        /final active passkey/i,
      );
      await assert.rejects(
        () => prisma.user.update({ where: { id: user.id }, data: { authenticationPolicyVersion: 7 } }),
        /authenticationPolicyVersion/i,
      );
      await assert.rejects(
        () => prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } }),
        /verified recovery email/i,
      );

      const revokeRaceUser = await createUser("revoke-race");
      const revokeRaceA = await createCredential(revokeRaceUser, "revoke-race-a");
      const revokeRaceB = await createCredential(revokeRaceUser, "revoke-race-b");
      await prisma.user.update({
        where: { id: revokeRaceUser.id },
        data: { passkeyMfaEnabledAt: new Date(), authenticationPolicyVersion: { increment: 1 } },
      });
      const revokes = await Promise.allSettled([
        prisma.webAuthnCredential.update({ where: { id: revokeRaceA.id }, data: { revokedAt: new Date() } }),
        prisma.webAuthnCredential.update({ where: { id: revokeRaceB.id }, data: { revokedAt: new Date() } }),
      ]);
      assert.equal(revokes.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(revokes.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await prisma.webAuthnCredential.count({ where: { userId: revokeRaceUser.id, revokedAt: null } }), 1);

      const loginToken = makeOpaqueToken();
      const loginCsrf = makeOpaqueToken();
      const loginChallenge = makeOpaqueToken();
      await mfa.beginMfaLogin({
        userId: user.id,
        credentialVersion: enabled.credentialVersion,
        authenticationPolicyVersion: enabled.authenticationPolicyVersion,
        transactionTokenHash: hashSecret(loginToken),
        csrfTokenHash: hashSecret(loginCsrf),
        challengeHash: hashSecret(loginChallenge),
      });
      const storedTransaction = await prisma.passkeyMfaLoginTransaction.findUniqueOrThrow({
        where: { transactionTokenHash: hashSecret(loginToken) },
      });
      assert.equal(Object.hasOwn(storedTransaction, "transactionToken"), false);
      assert.equal(await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }), 0);

      const claims = await Promise.allSettled([
        mfa.claimMfaLogin({
          transactionTokenHash: hashSecret(loginToken), csrfTokenHash: hashSecret(loginCsrf),
          challengeHash: hashSecret(loginChallenge), credentialId: credential.credentialId,
        }),
        mfa.claimMfaLogin({
          transactionTokenHash: hashSecret(loginToken), csrfTokenHash: hashSecret(loginCsrf),
          challengeHash: hashSecret(loginChallenge), credentialId: credential.credentialId,
        }),
      ]);
      assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
      const claim = claims.find((result) => result.status === "fulfilled").value;
      await mfa.completeMfaLogin({
        challengeId: claim.ceremonyId,
        credentialId: claim.credential.id,
        expectedCounter: claim.credential.counter,
        newCounter: 0n,
        transactionTokenHash: hashSecret(loginToken),
        csrfTokenHash: hashSecret(loginCsrf),
        sessionTokenHash: hashSecret(makeOpaqueToken()),
        sessionCsrfTokenHash: hashSecret(makeOpaqueToken()),
        pendingSessionExpiresAt: new Date(Date.now() + 60_000),
        ipAddress: null,
        userAgent: "real-db-test",
      });
      assert.equal(await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }), 1);
      const mfaPendingSession = await prisma.identitySession.findFirstOrThrow({
        where: { userId: user.id, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(mfaPendingSession.activatedAt, null);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt, null);
      await assert.rejects(
        () => mfa.claimMfaLogin({
          transactionTokenHash: hashSecret(loginToken), csrfTokenHash: hashSecret(loginCsrf),
          challengeHash: hashSecret(loginChallenge), credentialId: credential.credentialId,
        }),
      );

      const disableSession = await createSession(enabled, "disable-active");
      const pendingBeforeDisable = await createSession(enabled, "pending-before-disable", { activatedAt: null });
      const disableHash = hashSecret(makeOpaqueToken());
      await mfa.beginStepUp({
        userId: user.id,
        identitySessionId: disableSession.id,
        purpose: "DISABLE_MFA",
        expectedCredentialVersion: enabled.credentialVersion,
        expectedAuthenticationPolicyVersion: enabled.authenticationPolicyVersion,
        challengeHash: disableHash,
      });
      const disableClaim = await mfa.claimStepUp({
        userId: user.id,
        identitySessionId: disableSession.id,
        purpose: "DISABLE_MFA",
        challengeHash: disableHash,
        credentialId: credential.credentialId,
      });
      await mfa.completeStepUp({
        userId: user.id,
        identitySessionId: disableSession.id,
        purpose: "DISABLE_MFA",
        challengeId: disableClaim.ceremonyId,
        credentialId: disableClaim.credential.id,
        expectedCounter: disableClaim.credential.counter,
        newCounter: 0n,
      });
      const disabledMfa = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(disabledMfa.passkeyMfaEnabledAt, null);
      assert.equal(disabledMfa.authenticationPolicyVersion, 3);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: disableSession.id } })).revokedAt);
      assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: pendingBeforeDisable.id } })).revokedAt);
      assert.equal(await prisma.identityAuditLog.count({ where: { action: "PASSKEY_MFA_DISABLED", targetUserId: user.id } }), 1);
      assert.equal(await prisma.notificationOutbox.count({ where: { kind: "PASSKEY_MFA_DISABLED", userId: user.id } }), 1);

      const staleUser = await createUser("stale-mfa");
      const staleCredential = await createCredential(staleUser, "stale-mfa");
      await prisma.user.update({
        where: { id: staleUser.id },
        data: { passkeyMfaEnabledAt: new Date(), authenticationPolicyVersion: { increment: 1 } },
      });
      const staleToken = makeOpaqueToken();
      const staleCsrf = makeOpaqueToken();
      const staleChallenge = makeOpaqueToken();
      await mfa.beginMfaLogin({
        userId: staleUser.id,
        credentialVersion: staleUser.credentialVersion,
        authenticationPolicyVersion: staleUser.authenticationPolicyVersion + 1,
        transactionTokenHash: hashSecret(staleToken), csrfTokenHash: hashSecret(staleCsrf), challengeHash: hashSecret(staleChallenge),
      });
      await prisma.user.update({
        where: { id: staleUser.id },
        data: { passkeyMfaEnabledAt: null, authenticationPolicyVersion: { increment: 1 } },
      });
      await assert.rejects(
        () => mfa.claimMfaLogin({
          transactionTokenHash: hashSecret(staleToken), csrfTokenHash: hashSecret(staleCsrf),
          challengeHash: hashSecret(staleChallenge), credentialId: staleCredential.credentialId,
        }),
      );

      const recoveryUser = await createUser("recovery");
      const recoveryCredential = await createCredential(recoveryUser, "recovery");
      await prisma.user.update({
        where: { id: recoveryUser.id },
        data: { passkeyMfaEnabledAt: new Date(), authenticationPolicyVersion: { increment: 1 } },
      });
      await createSession(recoveryUser, "recovery");
      const recoveryRawToken = makeOpaqueToken();
      const recoveryCurrent = await prisma.user.findUniqueOrThrow({ where: { id: recoveryUser.id } });
      await prisma.passwordRecoveryToken.create({
        data: {
          userId: recoveryUser.id,
          tokenHash: hashSecret(recoveryRawToken),
          credentialVersionSnapshot: recoveryCurrent.credentialVersion,
          emailVerificationVersionSnapshot: recoveryCurrent.emailVerificationVersion,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await recovery.completePasswordReset({
        tokenHash: hashSecret(recoveryRawToken),
        passwordHash: await argon2.hash("recovered password is long enough", { type: argon2.argon2id }),
      });
      const recovered = await prisma.user.findUniqueOrThrow({ where: { id: recoveryUser.id } });
      assert.equal(recovered.passkeyMfaEnabledAt, null);
      assert.equal(recovered.authenticationPolicyVersion, 3);
      assert.ok((await prisma.webAuthnCredential.findUniqueOrThrow({ where: { id: recoveryCredential.id } })).revokedAt);
      assert.equal(await prisma.identitySession.count({ where: { userId: recoveryUser.id, revokedAt: null } }), 0);
      assert.equal(await prisma.identityAuditLog.count({ where: { action: "PASSKEYS_RESET_BY_RECOVERY", targetUserId: recoveryUser.id } }), 1);
      assert.equal(await prisma.notificationOutbox.count({ where: { kind: "AUTHENTICATORS_RESET_BY_RECOVERY", userId: recoveryUser.id } }), 1);
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
