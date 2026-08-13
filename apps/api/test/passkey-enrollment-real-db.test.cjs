const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");

const databaseUrl = process.env.PASSKEY_ENROLLMENT_DATABASE_URL;

if (databaseUrl === undefined) {
  test("passkey-enrollment real database proof is opt-in", { skip: "PASSKEY_ENROLLMENT_DATABASE_URL is not set" }, () => {});
} else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const {
    PasskeyCeremonyInvalidError,
    PasskeyConflictError,
    PasskeyNotFoundError,
  } = require("../dist/modules/auth/application/passkey-enrollment.errors.js");
  const {
    PrismaPasskeyEnrollmentRepository,
  } = require("../dist/modules/auth/infrastructure/prisma-passkey-enrollment.repository.js");

  test("passkey registration lifecycle preserves PostgreSQL challenge, ownership, atomicity, and concurrency invariants", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const repository = new PrismaPasskeyEnrollmentRepository(prisma);
    const fixture = `pr004k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const passwordHash = await argon2.hash("passkey review password long enough", { type: argon2.argon2id });
    const users = [];
    const sessions = [];
    const credentials = [];
    const challenges = [];

    async function createUser(label, overrides = {}) {
      const user = await prisma.user.create({
        data: {
          email: `${fixture}-${label}@example.test`,
          displayName: `PR-004K ${label}`,
          passwordHash,
          ...overrides,
        },
      });
      users.push(user.id);
      return user;
    }

    async function createSession(user, overrides = {}) {
      const session = await prisma.identitySession.create({
        data: {
          userId: user.id,
          tokenHash: `${fixture}-session-token-${sessions.length}`,
          csrfTokenHash: `${fixture}-csrf-token-${sessions.length}`,
          credentialVersion: user.credentialVersion,
          expiresAt: new Date(Date.now() + 60_000),
          ...overrides,
        },
      });
      sessions.push(session.id);
      return session;
    }

    async function begin(user, session, challengeHash) {
      const result = await repository.beginRegistration({
        userId: user.id,
        identitySessionId: session.id,
        expectedCredentialVersion: user.credentialVersion,
        challengeHash,
      });
      const challenge = await prisma.webAuthnRegistrationChallenge.findUniqueOrThrow({ where: { challengeHash } });
      challenges.push(challenge.id);
      return { result, challenge };
    }

    function verifiedCredential(credentialId) {
      return {
        credentialId,
        publicKey: Uint8Array.from([1, 2, 3, 4]),
        counter: 4n,
        transports: ["internal"],
        deviceType: "multiDevice",
        backedUp: true,
      };
    }

    async function claimAndComplete(user, session, challenge, credentialId) {
      const claim = await repository.claimRegistrationChallenge({
        userId: user.id,
        identitySessionId: session.id,
        challengeHash: challenge.challengeHash,
      });
      const created = await repository.completeRegistration({
        userId: user.id,
        identitySessionId: session.id,
        challengeId: claim.challengeId,
        credential: verifiedCredential(credentialId),
      });
      credentials.push(created.id);
      return created;
    }

    const user = await createUser("user");
    const session = await createSession(user);
    const otherUser = await createUser("other");
    const otherSession = await createSession(otherUser);

    try {
      const first = await begin(user, session, `${fixture}-challenge-one`);
      assert.equal(first.result.email, user.email);
      assert.equal(first.result.activeCredentials.length, 0);
      assert.match(first.challenge.challengeHash, /challenge-one$/);
      assert.equal(first.challenge.credentialVersionSnapshot, user.credentialVersion);
      assert.equal(first.challenge.consumedAt, null);

      const created = await claimAndComplete(user, session, first.challenge, `${fixture}-credential-one`);
      const stored = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(stored.userId, user.id);
      assert.equal(stored.credentialId, `${fixture}-credential-one`);
      assert.deepEqual([...stored.publicKey], [1, 2, 3, 4]);
      assert.equal(stored.counter, 4n);
      assert.equal(stored.revokedAt, null);
      assert.ok((await prisma.webAuthnRegistrationChallenge.findUniqueOrThrow({ where: { id: first.challenge.id } })).consumedAt);
      const audit = await prisma.identityAuditLog.findFirstOrThrow({
        where: { action: "PASSKEY_REGISTERED", targetUserId: user.id },
      });
      assert.equal(audit.actorUserId, user.id);
      assert.equal(JSON.stringify(audit).includes(`${fixture}-credential-one`), false);

      await assert.rejects(
        () => repository.claimRegistrationChallenge({
          userId: user.id, identitySessionId: session.id, challengeHash: first.challenge.challengeHash,
        }),
        PasskeyCeremonyInvalidError,
      );

      const second = await begin(user, session, `${fixture}-challenge-two`);
      await assert.rejects(
        () => repository.claimRegistrationChallenge({
          userId: otherUser.id, identitySessionId: otherSession.id, challengeHash: second.challenge.challengeHash,
        }),
        PasskeyCeremonyInvalidError,
      );
      assert.equal((await prisma.webAuthnRegistrationChallenge.findUniqueOrThrow({ where: { id: second.challenge.id } })).consumedAt, null);

      const sessionTwo = await createSession(user);
      await assert.rejects(
        () => repository.claimRegistrationChallenge({
          userId: user.id, identitySessionId: sessionTwo.id, challengeHash: second.challenge.challengeHash,
        }),
        PasskeyCeremonyInvalidError,
      );
      assert.equal((await prisma.webAuthnRegistrationChallenge.findUniqueOrThrow({ where: { id: second.challenge.id } })).consumedAt, null);

      const changed = await begin(user, session, `${fixture}-challenge-version`);
      const passwordChangedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await argon2.hash("passkey review changed password long enough", { type: argon2.argon2id }),
          credentialVersion: { increment: 1 },
        },
      });
      await assert.rejects(
        () => repository.claimRegistrationChallenge({
          userId: user.id, identitySessionId: session.id, challengeHash: changed.challenge.challengeHash,
        }),
        PasskeyCeremonyInvalidError,
      );
      await prisma.identitySession.update({ where: { id: session.id }, data: { credentialVersion: 2 } });
      user.credentialVersion = passwordChangedUser.credentialVersion;

      const disabled = await begin(user, session, `${fixture}-challenge-disabled`);
      await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
      await assert.rejects(
        () => repository.claimRegistrationChallenge({
          userId: user.id, identitySessionId: session.id, challengeHash: disabled.challenge.challengeHash,
        }),
        PasskeyCeremonyInvalidError,
      );
      await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });

      const replay = await begin(user, session, `${fixture}-challenge-concurrent`);
      const concurrentClaims = await Promise.allSettled([
        repository.claimRegistrationChallenge({ userId: user.id, identitySessionId: session.id, challengeHash: replay.challenge.challengeHash }),
        repository.claimRegistrationChallenge({ userId: user.id, identitySessionId: session.id, challengeHash: replay.challenge.challengeHash }),
      ]);
      assert.equal(concurrentClaims.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(concurrentClaims.filter((outcome) => outcome.status === "rejected").length, 1);
      const winner = concurrentClaims.find((outcome) => outcome.status === "fulfilled").value;
      const concurrentPasskey = await repository.completeRegistration({
        userId: user.id,
        identitySessionId: session.id,
        challengeId: winner.challengeId,
        credential: verifiedCredential(`${fixture}-credential-concurrent`),
      });
      credentials.push(concurrentPasskey.id);

      const duplicateA = await begin(user, session, `${fixture}-challenge-duplicate-a`);
      const duplicateB = await begin(otherUser, otherSession, `${fixture}-challenge-duplicate-b`);
      const claimA = await repository.claimRegistrationChallenge({ userId: user.id, identitySessionId: session.id, challengeHash: duplicateA.challenge.challengeHash });
      const claimB = await repository.claimRegistrationChallenge({ userId: otherUser.id, identitySessionId: otherSession.id, challengeHash: duplicateB.challenge.challengeHash });
      const duplicateResults = await Promise.allSettled([
        repository.completeRegistration({
          userId: user.id, identitySessionId: session.id, challengeId: claimA.challengeId,
          credential: verifiedCredential(`${fixture}-credential-shared`),
        }),
        repository.completeRegistration({
          userId: otherUser.id, identitySessionId: otherSession.id, challengeId: claimB.challengeId,
          credential: verifiedCredential(`${fixture}-credential-shared`),
        }),
      ]);
      assert.equal(duplicateResults.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(duplicateResults.filter((outcome) => outcome.status === "rejected").length, 1);
      const shared = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { credentialId: `${fixture}-credential-shared` } });
      credentials.push(shared.id);
      assert.ok([user.id, otherUser.id].includes(shared.userId));

      const listed = await repository.listPasskeys(user.id);
      assert.equal(listed.every((row) => Object.hasOwn(row, "publicKey") === false && Object.hasOwn(row, "credentialId") === false), true);
      const renamed = await repository.renamePasskey({
        userId: user.id, identitySessionId: session.id, passkeyId: created.id, displayName: "Office key",
      });
      assert.equal(renamed.displayName, "Office key");
      await assert.rejects(
        () => repository.renamePasskey({
          userId: otherUser.id, identitySessionId: otherSession.id, passkeyId: created.id, displayName: "attacker",
        }),
        PasskeyNotFoundError,
      );
      const revoked = await repository.revokePasskey({
        userId: user.id, identitySessionId: session.id, passkeyId: created.id, expectedCredentialVersion: 2,
      });
      assert.ok(revoked.revokedAt);
      assert.ok((await prisma.webAuthnCredential.findUniqueOrThrow({ where: { id: created.id } })).revokedAt);
      await assert.rejects(
        () => repository.revokePasskey({
          userId: user.id, identitySessionId: session.id, passkeyId: created.id, expectedCredentialVersion: 2,
        }),
        PasskeyConflictError,
      );

      const rollback = await begin(user, session, `${fixture}-challenge-audit-rollback`);
      const rollbackClaim = await repository.claimRegistrationChallenge({
        userId: user.id, identitySessionId: session.id, challengeHash: rollback.challenge.challengeHash,
      });
      const functionName = `pr004k_rollback_${Date.now()}`;
      const triggerName = `${functionName}_trigger`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$
        BEGIN RAISE EXCEPTION 'forced passkey audit failure'; END;
        $$ LANGUAGE plpgsql;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "IdentityAuditLog"
        FOR EACH ROW
        WHEN (NEW."action" = 'PASSKEY_REGISTERED'::"IdentityAuditAction")
        EXECUTE FUNCTION "${functionName}"();
      `);
      try {
        await assert.rejects(() => repository.completeRegistration({
          userId: user.id,
          identitySessionId: session.id,
          challengeId: rollbackClaim.challengeId,
          credential: verifiedCredential(`${fixture}-credential-rollback`),
        }));
        assert.equal(await prisma.webAuthnCredential.count({ where: { credentialId: `${fixture}-credential-rollback` } }), 0);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "IdentityAuditLog";`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
      }
    } finally {
      await prisma.identityAuditLog.deleteMany({ where: { targetUserId: { in: users } } });
      await prisma.webAuthnCredential.deleteMany({ where: { id: { in: credentials } } });
      await prisma.webAuthnRegistrationChallenge.deleteMany({ where: { id: { in: challenges } } });
      await prisma.webAuthnRegistrationChallenge.deleteMany({ where: { userId: { in: users } } });
      await prisma.webAuthnCredential.deleteMany({ where: { userId: { in: users } } });
      await prisma.identitySession.deleteMany({ where: { id: { in: sessions } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  });
}
