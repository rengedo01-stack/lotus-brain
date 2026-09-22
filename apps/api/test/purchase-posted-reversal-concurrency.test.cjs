const test = require("node:test");
const assert = require("node:assert/strict");

const { ConflictException } = require("@nestjs/common");
const { PurchasePostedReversalService } = require("../dist/modules/purchase/application/purchase-posted-reversal.service.js");
const { PurchasePostedReversalConflictError } = require("../dist/modules/purchase/application/purchase-posted-reversal.errors.js");
const { PrismaPurchasePostedReversalRepository } = require("../dist/modules/purchase/infrastructure/prisma-purchase-posted-reversal.repository.js");
const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");

const input = {
  purchaseId: "purchase-1",
  actorUserId: "user-1",
  reason: "correction",
  previewVersion: "a".repeat(64),
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  priceResolutions: [],
};

function prismaError(code, { metaCode, message } = {}) {
  const error = new Error(message ?? `Prisma error ${code}`);
  error.code = code;
  if (metaCode !== undefined) error.meta = { code: metaCode };
  return error;
}

function repositoryThatRejects(error) {
  let transactions = 0;
  const repository = new PrismaPurchasePostedReversalRepository({
    $transaction: async () => {
      transactions += 1;
      throw error;
    },
  });
  return { repository, transactionCount: () => transactions };
}

function controllerFor(repository) {
  return new PurchaseController({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, new PurchasePostedReversalService(repository));
}

function response() {
  return {
    statusCode: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

async function assertDomainConflict(error) {
  const subject = repositoryThatRejects(error);
  await assert.rejects(
    () => subject.repository.execute(input),
    (actual) => actual instanceof PurchasePostedReversalConflictError,
  );
  assert.equal(subject.transactionCount(), 1);
}

async function assertControllerConflict(error) {
  const subject = repositoryThatRejects(error);
  await assert.rejects(
    () => controllerFor(subject.repository).createPurchaseReversal(
      { authUser: { id: input.actorUserId } },
      input.purchaseId,
      input,
      response(),
    ),
    (actual) => actual instanceof ConflictException && actual.getStatus() === 409,
  );
  assert.equal(subject.transactionCount(), 1);
}

async function assertOriginalErrorPropagates(error) {
  const subject = repositoryThatRejects(error);
  await assert.rejects(
    () => subject.repository.execute(input),
    (actual) => actual === error,
  );
  assert.equal(subject.transactionCount(), 1);

  const controllerSubject = repositoryThatRejects(error);
  await assert.rejects(
    () => controllerFor(controllerSubject.repository).createPurchaseReversal(
      { authUser: { id: input.actorUserId } },
      input.purchaseId,
      input,
      response(),
    ),
    (actual) => actual === error,
  );
  assert.equal(controllerSubject.transactionCount(), 1);
}

test("P2010 with meta.code 40001 becomes a domain conflict and HTTP 409", async () => {
  await assertDomainConflict(prismaError("P2010", {
    metaCode: "40001",
    message: "Raw query failed. Code: `40001`. Message: serialization failure.",
  }));
  await assertControllerConflict(prismaError("P2010", {
    metaCode: "40001",
    message: "Raw query failed. Code: `40001`. Message: serialization failure.",
  }));
});

test("P2010 with 40001 only in its message becomes a domain conflict and HTTP 409", async () => {
  await assertDomainConflict(prismaError("P2010", {
    metaCode: "XX000",
    message: "Raw query failed. Code: `40001`. Message: serialization failure.",
  }));
  await assertControllerConflict(prismaError("P2010", {
    metaCode: "XX000",
    message: "Raw query failed. Code: `40001`. Message: serialization failure.",
  }));
});

test("P2010 with meta.code 40P01 and no 40001 propagates instead of becoming HTTP 409", async () => {
  await assertOriginalErrorPropagates(prismaError("P2010", {
    metaCode: "40P01",
    message: "Raw query failed. Code: `40P01`. Message: deadlock detected.",
  }));
});

test("P2010 without 40001 propagates its original error", async () => {
  await assertOriginalErrorPropagates(prismaError("P2010", {
    metaCode: "XX000",
    message: "Raw query failed. Code: `XX000`. Message: internal error.",
  }));
});

test("direct P2002 remains a domain conflict", async () => {
  await assertDomainConflict(prismaError("P2002"));
});

test("direct P2034 remains a domain conflict", async () => {
  await assertDomainConflict(prismaError("P2034"));
});

test("direct 40001 remains a domain conflict", async () => {
  await assertDomainConflict(prismaError("40001"));
});

test("direct 40P01 remains a domain conflict", async () => {
  await assertDomainConflict(prismaError("40P01"));
});
