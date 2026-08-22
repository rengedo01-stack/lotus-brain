import { Inject, Injectable } from "@nestjs/common";
import {
  PRODUCTION_LIFECYCLE_REPOSITORY,
  type ProductionCreateInput,
  type ProductionDraftPatchInput,
  type ProductionLifecycleRepository,
  type ProductionView,
} from "./production-lifecycle.repository";
import {
  ProductionLifecycleConflictError,
  ProductionLifecycleNotFoundError,
  ProductionLifecycleValidationError,
} from "./production-lifecycle.errors";

@Injectable()
export class CreateProductionUseCase {
  constructor(@Inject(PRODUCTION_LIFECYCLE_REPOSITORY) private readonly repository: ProductionLifecycleRepository) {}

  execute(input: ProductionCreateInput): Promise<ProductionView> {
    return this.repository.create(input);
  }
}

@Injectable()
export class GetProductionUseCase {
  constructor(@Inject(PRODUCTION_LIFECYCLE_REPOSITORY) private readonly repository: ProductionLifecycleRepository) {}

  async execute(id: string): Promise<ProductionView> {
    const production = await this.repository.get(id);
    if (production === null) throw new ProductionLifecycleNotFoundError(id);
    return production;
  }
}

@Injectable()
export class UpdateProductionDraftUseCase {
  constructor(@Inject(PRODUCTION_LIFECYCLE_REPOSITORY) private readonly repository: ProductionLifecycleRepository) {}

  async execute(id: string, input: ProductionDraftPatchInput): Promise<ProductionView> {
    if (input.productionDate === undefined && input.plannedQuantity === undefined && input.note === undefined) {
      throw new ProductionLifecycleValidationError("At least one editable Production field is required.");
    }
    const result = await this.repository.updateDraft(id, input);
    if (result === "NOT_FOUND") throw new ProductionLifecycleNotFoundError(id);
    if (result === "CONFLICT") throw new ProductionLifecycleConflictError(`Production ${id} is not editable.`);
    return result;
  }
}

@Injectable()
export class ConfirmProductionUseCase {
  constructor(@Inject(PRODUCTION_LIFECYCLE_REPOSITORY) private readonly repository: ProductionLifecycleRepository) {}

  async execute(id: string): Promise<ProductionView> {
    const result = await this.repository.confirm(id);
    if (result === "NOT_FOUND") throw new ProductionLifecycleNotFoundError(id);
    if (result === "CONFLICT") throw new ProductionLifecycleConflictError(`Production ${id} cannot be confirmed.`);
    return result;
  }
}
