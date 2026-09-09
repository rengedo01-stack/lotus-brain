import { Inject, Injectable } from "@nestjs/common";
import {
  REPLENISHMENT_POLICY_REPOSITORY,
  type CreateReplenishmentPolicyInput,
  type ReplenishmentPolicyRepository,
  type UpdateReplenishmentPolicyInput,
} from "./replenishment-policy.repository";
import { ReplenishmentPolicyConflictError, ReplenishmentPolicyNotFoundError } from "./replenishment-policy.errors";

@Injectable()
export class GetReplenishmentPolicyUseCase {
  constructor(@Inject(REPLENISHMENT_POLICY_REPOSITORY) private readonly repository: ReplenishmentPolicyRepository) {}

  async execute(productId: string) {
    const result = await this.repository.get(productId);
    if (result === null) throw new ReplenishmentPolicyNotFoundError(`Product ${productId} was not found.`);
    return result;
  }
}

@Injectable()
export class CreateReplenishmentPolicyUseCase {
  constructor(@Inject(REPLENISHMENT_POLICY_REPOSITORY) private readonly repository: ReplenishmentPolicyRepository) {}

  async execute(productId: string, input: CreateReplenishmentPolicyInput) {
    const result = await this.repository.create(productId, input);
    if (result === "NOT_FOUND") throw new ReplenishmentPolicyNotFoundError(`Product ${productId} was not found.`);
    if (result === "CONFLICT") throw new ReplenishmentPolicyConflictError("A replenishment policy cannot be created for this Product.");
    return result;
  }
}

@Injectable()
export class UpdateReplenishmentPolicyUseCase {
  constructor(@Inject(REPLENISHMENT_POLICY_REPOSITORY) private readonly repository: ReplenishmentPolicyRepository) {}

  async execute(productId: string, input: UpdateReplenishmentPolicyInput) {
    const result = await this.repository.update(productId, input);
    if (result === "NOT_FOUND") throw new ReplenishmentPolicyNotFoundError(`Replenishment policy for Product ${productId} was not found.`);
    if (result === "CONFLICT") throw new ReplenishmentPolicyConflictError("The replenishment policy or Product state changed. Reload before editing again.");
    return result;
  }
}
