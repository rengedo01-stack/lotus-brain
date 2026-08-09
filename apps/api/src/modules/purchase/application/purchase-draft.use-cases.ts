import { Inject, Injectable } from "@nestjs/common";
import {
  PurchaseDraftConflictError,
  PurchaseDraftNotFoundError,
  PurchaseDraftValidationError,
} from "./purchase-draft.errors";
import { PURCHASE_DRAFT_REPOSITORY, type PurchaseDraftRepository, type PurchaseDraftInput, type PurchaseDraftView } from "../infrastructure/purchase-draft.repository";

@Injectable()
export class CreatePurchaseDraftUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}
  execute(input: PurchaseDraftInput): Promise<PurchaseDraftView> { return this.repository.create(input); }
}

@Injectable()
export class GetPurchaseUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}
  async execute(id: string): Promise<PurchaseDraftView> {
    const purchase = await this.repository.get(id);
    if (!purchase) throw new PurchaseDraftNotFoundError(`Purchase ${id} was not found.`);
    return purchase;
  }
}

@Injectable()
export class UpdatePurchaseDraftUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}
  async execute(id: string, input: PurchaseDraftInput): Promise<PurchaseDraftView> {
    const result = await this.repository.updateDraft(id, input);
    if (result === "NOT_FOUND") throw new PurchaseDraftNotFoundError(`Purchase ${id} was not found.`);
    if (result === "CONFLICT") throw new PurchaseDraftConflictError(`Purchase ${id} is not editable.`);
    return result;
  }
}

@Injectable()
export class ConfirmPurchaseUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}
  async execute(id: string): Promise<PurchaseDraftView> {
    const result = await this.repository.confirm(id);
    if (result === "NOT_FOUND") throw new PurchaseDraftNotFoundError(`Purchase ${id} was not found.`);
    if (result === "CONFLICT") throw new PurchaseDraftConflictError(`Purchase ${id} cannot be confirmed.`);
    return result;
  }
}

export { PurchaseDraftValidationError };
