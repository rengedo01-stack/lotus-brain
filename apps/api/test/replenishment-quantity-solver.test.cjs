const test = require("node:test");
const assert = require("node:assert/strict");

const { rawTargetGap, solveReplenishmentQuantity } = require("../dist/modules/inventory/domain/replenishment-quantity-solver.js");

const solve = (input) => solveReplenishmentQuantity({
  rawTargetGap: input.gap,
  minimumOrderQuantity: input.minimum ?? null,
  orderMultipleQuantity: input.multiple ?? null,
  packageSize: input.package ?? null,
});

test("exact Decimal solver finds the policy examples without floating point arithmetic", () => {
  const examples = [
    [{ gap: "7" }, "7", "0", null],
    [{ gap: "7", minimum: "10" }, "10", "3", null],
    [{ gap: "12", multiple: "5" }, "15", "3", null],
    [{ gap: "7", minimum: "12", multiple: "5" }, "15", "8", null],
    [{ gap: "12", package: "10" }, "20", "8", "2"],
    [{ gap: "12", minimum: "12", multiple: "5", package: "10" }, "20", "8", "2"],
    [{ gap: "12", minimum: "12", multiple: "5", package: "6" }, "30", "18", "5"],
    [{ gap: "4", multiple: "2.5", package: "1.5" }, "7.5", "3.5", "5"],
  ];
  for (const [input, feasibleQuantity, overOrderQuantity, packageCount] of examples) {
    const result = solve(input);
    assert.equal(result.status, "READY");
    assert.equal(result.feasibleQuantity, feasibleQuantity);
    assert.equal(result.overOrderQuantity, overOrderQuantity);
    assert.equal(result.packageCount, packageCount);
  }
});

test("exact Decimal solver canonicalizes equivalent values and honors exact boundaries", () => {
  assert.equal(rawTargetGap("1.000000000", "0.999999999"), "0.000000001");
  assert.equal(rawTargetGap("2.500", "1.0"), "1.5");
  const result = solve({ gap: "1.000000000", minimum: "1.0", multiple: "0.000000001", package: "0.125" });
  assert.equal(result.status, "READY");
  assert.equal(result.rawTargetGap, "1");
  assert.equal(result.minimumOrderQuantity, "1");
  assert.equal(result.orderMultipleQuantity, "0.000000001");
  assert.equal(result.packageSize, "0.125");
  assert.equal(result.feasibleQuantity, "1");
  assert.equal(result.packageCount, "8");
});

test("positive-need gate does not let MOQ trigger an order", () => {
  const result = solve({ gap: "0", minimum: "999999999999999.999999999", multiple: "0.125", package: "0.5" });
  assert.deepEqual(result, {
    status: "NO_POSITIVE_NEED",
    rawTargetGap: "0",
    minimumOrderQuantity: "999999999999999.999999999",
    orderMultipleQuantity: "0.125",
    packageSize: "0.5",
    feasibleQuantity: null,
    overOrderQuantity: null,
    packageCount: null,
  });
});

test("exact LCM growth fails closed only when the final quantity exceeds Decimal(24,9)", () => {
  const ready = solve({ gap: "1", multiple: "999999999999999.999999999", package: "999999999999999.999999999" });
  assert.equal(ready.status, "READY");
  assert.equal(ready.feasibleQuantity, "999999999999999.999999999");
  assert.equal(ready.packageCount, "1");

  const unrepresentable = solve({ gap: "1", multiple: "999999999999999.999999999", package: "999999999999999.999999998" });
  assert.equal(unrepresentable.status, "CONSTRAINT_UNREPRESENTABLE");
  assert.equal(unrepresentable.feasibleQuantity, null);
  assert.equal(unrepresentable.packageCount, null);
});

test("exact solver rejects non-canonical, non-positive, and floating-style inputs", () => {
  for (const input of [
    { gap: "-1" },
    { gap: "01" },
    { gap: "1e-9" },
    { gap: "1.0000000000" },
    { gap: "1", multiple: "0" },
    { gap: "1", package: "-2" },
  ]) assert.throws(() => solve(input));
});
