import type { MasterStatus } from "../../../generated/prisma/client";

export type ReplenishmentPolicyView = {
  id: string;
  productId: string;
  reorderPointQuantity: string;
  targetStockQuantity: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ReplenishmentPolicyProductView = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  isDeleted: boolean;
  inventoryUnit: {
    code: string;
    name: string;
    symbol: string;
  };
};

export type ReplenishmentPolicyContextView = {
  product: ReplenishmentPolicyProductView;
  policy: ReplenishmentPolicyView | null;
};

export type CreateReplenishmentPolicyInput = {
  reorderPointQuantity: string;
  targetStockQuantity: string | null;
};

export type UpdateReplenishmentPolicyInput = CreateReplenishmentPolicyInput & {
  expectedVersion: number;
};

export interface ReplenishmentPolicyRepository {
  get(productId: string): Promise<ReplenishmentPolicyContextView | null>;
  create(productId: string, input: CreateReplenishmentPolicyInput): Promise<ReplenishmentPolicyView | "NOT_FOUND" | "CONFLICT">;
  update(productId: string, input: UpdateReplenishmentPolicyInput): Promise<ReplenishmentPolicyView | "NOT_FOUND" | "CONFLICT">;
}

export const REPLENISHMENT_POLICY_REPOSITORY = Symbol("REPLENISHMENT_POLICY_REPOSITORY");
