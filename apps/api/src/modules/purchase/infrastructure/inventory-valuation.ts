import { Prisma } from "../../../generated/prisma/client";

const INVENTORY_COST_SCALE = 6;

export function calculateNextAverageUnitCost(
  previousQuantity: Prisma.Decimal,
  previousAverageUnitCost: Prisma.Decimal | null,
  receivedQuantity: Prisma.Decimal,
  receivedUnitCost: Prisma.Decimal,
): Prisma.Decimal {
  if (previousQuantity.isZero()) {
    return receivedUnitCost;
  }

  if (previousAverageUnitCost === null) {
    throw new Error("A non-zero inventory quantity requires an average unit cost.");
  }

  return previousQuantity
    .mul(previousAverageUnitCost)
    .add(receivedQuantity.mul(receivedUnitCost))
    .div(previousQuantity.add(receivedQuantity))
    .toDecimalPlaces(INVENTORY_COST_SCALE);
}
