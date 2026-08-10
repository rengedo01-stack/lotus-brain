const test = require("node:test");
const assert = require("node:assert/strict");

const { Prisma } = require("../dist/generated/prisma/client.js");
const {
  calculateNextAverageUnitCost,
} = require("../dist/modules/purchase/infrastructure/inventory-valuation.js");

const decimal = (value) => new Prisma.Decimal(value);

test("initial receipt uses the received unit cost", () => {
  const result = calculateNextAverageUnitCost(decimal("0"), null, decimal("10"), decimal("1000"));
  assert.equal(result.toFixed(6), "1000.000000");
});

test("receipts calculate a weighted average with decimal arithmetic", () => {
  const result = calculateNextAverageUnitCost(
    decimal("10"),
    decimal("1000"),
    decimal("10"),
    decimal("1200"),
  );
  assert.equal(result.toFixed(6), "1100.000000");
});

test("a different receipt quantity produces the expected weighted average", () => {
  const result = calculateNextAverageUnitCost(
    decimal("10"),
    decimal("1000"),
    decimal("5"),
    decimal("1300"),
  );
  assert.equal(result.toFixed(6), "1100.000000");
});

test("a zero balance resets valuation to the next receipt cost", () => {
  const result = calculateNextAverageUnitCost(
    decimal("0"),
    decimal("1100"),
    decimal("5"),
    decimal("1400"),
  );
  assert.equal(result.toFixed(6), "1400.000000");
});

test("a non-zero unvalued balance is rejected", () => {
  assert.throws(
    () => calculateNextAverageUnitCost(decimal("1"), null, decimal("1"), decimal("1000")),
    /requires an average unit cost/,
  );
});
