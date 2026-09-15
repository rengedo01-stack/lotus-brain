import { Inject, Injectable } from "@nestjs/common";
import {
  PurchaseDraftConflictError,
  PurchaseDraftForbiddenError,
  PurchaseDraftNotFoundError,
  PurchaseDraftValidationError,
} from "./purchase-draft.errors";
import { PURCHASE_DRAFT_REPOSITORY, type PurchaseDraftRepository, type PurchaseDraftInput, type PurchaseDraftMetadataInput, type PurchaseDraftView, type PurchaseCancellationView } from "../infrastructure/purchase-draft.repository";

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
export class UpdatePurchaseDraftMetadataUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}
  async execute(id: string, input: PurchaseDraftMetadataInput): Promise<PurchaseDraftView> {
    const result = await this.repository.updateMetadata(id, input);
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

@Injectable()
export class CancelPurchaseUseCase {
  constructor(@Inject(PURCHASE_DRAFT_REPOSITORY) private readonly repository: PurchaseDraftRepository) {}

  async execute(id: string, reason: string, actorUserId: string): Promise<PurchaseCancellationView> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) throw new PurchaseDraftValidationError("Cancellation reason cannot be empty.");
    if (normalizedReason.length > 10_000) throw new PurchaseDraftValidationError("Cancellation reason is too long.");
    const result = await this.repository.cancel(id, normalizedReason, actorUserId);
    if (result === "NOT_FOUND") throw new PurchaseDraftNotFoundError(`Purchase ${id} was not found.`);
    if (result === "CONFLICT") throw new PurchaseDraftConflictError(`Purchase ${id} cannot be cancelled.`);
    if (result === "FORBIDDEN") throw new PurchaseDraftForbiddenError("Permission denied.");
    return result;
  }
}

export { PurchaseDraftValidationError };
