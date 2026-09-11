const SCALE = 1_000_000_000n;
const MAX_SCALED_DECIMAL_24_9 = 999_999_999_999_999_999_999_999n;
const NON_NEGATIVE_DECIMAL_24_9 = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;
const POSITIVE_DECIMAL_24_9 = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export type QuantitySolverInput = {
  rawTargetGap: string;
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  packageSize: string | null;
};

export type QuantitySolverReady = {
  status: "READY";
  rawTargetGap: string;
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  packageSize: string | null;
  feasibleQuantity: string;
  overOrderQuantity: string;
  packageCount: string | null;
};

export type QuantitySolverNoPositiveNeed = {
  status: "NO_POSITIVE_NEED";
  rawTargetGap: "0";
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  packageSize: string | null;
  feasibleQuantity: null;
  overOrderQuantity: null;
  packageCount: null;
};

export type QuantitySolverUnrepresentable = {
  status: "CONSTRAINT_UNREPRESENTABLE";
  rawTargetGap: string;
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  packageSize: string | null;
  feasibleQuantity: null;
  overOrderQuantity: null;
  packageCount: null;
};

export type QuantitySolverResult = QuantitySolverReady | QuantitySolverNoPositiveNeed | QuantitySolverUnrepresentable;

/**
 * Converts canonical Decimal(24,9) strings to a fixed 10^9 scaled integer.
 * This module deliberately has no Prisma dependency and never converts a
 * quantity through JavaScript Number.
 */
function parseScaled(value: string, positive: boolean): bigint {
  const pattern = positive ? POSITIVE_DECIMAL_24_9 : NON_NEGATIVE_DECIMAL_24_9;
  if (!pattern.test(value)) throw new Error("Expected a canonical Decimal(24,9) string.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, "0"));
}

function formatScaled(value: bigint): string {
  if (value < 0n || value > MAX_SCALED_DECIMAL_24_9) throw new Error("Decimal(24,9) result is not representable.");
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcm(left: bigint, right: bigint): bigint {
  return (left / gcd(left, right)) * right;
}

function ceilToStep(lowerBound: bigint, step: bigint): bigint {
  const quotient = lowerBound / step;
  return (lowerBound % step === 0n ? quotient : quotient + 1n) * step;
}

function canonicalNullable(value: string | null, positive: boolean): string | null {
  return value === null ? null : formatScaled(parseScaled(value, positive));
}

/** Exact target-current subtraction for non-negative canonical values. */
export function rawTargetGap(targetStockQuantity: string, currentQuantity: string): string {
  const target = parseScaled(targetStockQuantity, false);
  const current = parseScaled(currentQuantity, false);
  if (target < current) throw new Error("Target stock must not be lower than current quantity for a candidate.");
  return formatScaled(target - current);
}

/**
 * Finds the smallest Decimal(24,9) quantity satisfying the already-authorized
 * MOQ, order-multiple, and optional package constraints. Values that have a
 * mathematical answer but no representable Decimal(24,9) answer fail closed.
 */
export function solveReplenishmentQuantity(input: QuantitySolverInput): QuantitySolverResult {
  const gap = parseScaled(input.rawTargetGap, false);
  const minimum = input.minimumOrderQuantity === null ? null : parseScaled(input.minimumOrderQuantity, true);
  const multiple = input.orderMultipleQuantity === null ? null : parseScaled(input.orderMultipleQuantity, true);
  const packageSize = input.packageSize === null ? null : parseScaled(input.packageSize, true);
  const canonical = {
    rawTargetGap: formatScaled(gap),
    minimumOrderQuantity: canonicalNullable(input.minimumOrderQuantity, true),
    orderMultipleQuantity: canonicalNullable(input.orderMultipleQuantity, true),
    packageSize: canonicalNullable(input.packageSize, true),
  };

  if (gap === 0n) {
    return {
      status: "NO_POSITIVE_NEED",
      ...canonical,
      rawTargetGap: "0",
      feasibleQuantity: null,
      overOrderQuantity: null,
      packageCount: null,
    };
  }

  const lowerBound = minimum === null || gap >= minimum ? gap : minimum;
  let step: bigint | null = multiple;
  if (packageSize !== null) step = step === null ? packageSize : lcm(step, packageSize);
  const feasible = step === null ? lowerBound : ceilToStep(lowerBound, step);
  if (feasible > MAX_SCALED_DECIMAL_24_9) {
    return {
      status: "CONSTRAINT_UNREPRESENTABLE",
      ...canonical,
      feasibleQuantity: null,
      overOrderQuantity: null,
      packageCount: null,
    };
  }

  return {
    status: "READY",
    ...canonical,
    feasibleQuantity: formatScaled(feasible),
    overOrderQuantity: formatScaled(feasible - gap),
    packageCount: packageSize === null ? null : (feasible / packageSize).toString(),
  };
}
