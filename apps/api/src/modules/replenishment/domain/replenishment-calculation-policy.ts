// This is incremented only when the deterministic replenishment solver's
// business calculation changes. Older immutable snapshots must then be
// recalculated before they can be used for a Purchase handoff.
export const REPLENISHMENT_CALCULATION_POLICY_VERSION = 1;

export function isCurrentReplenishmentCalculationPolicyVersion(version: number): boolean {
  return version === REPLENISHMENT_CALCULATION_POLICY_VERSION;
}
