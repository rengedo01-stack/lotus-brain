import { Inject, Injectable } from "@nestjs/common";
import {
  REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY,
  type ReplenishmentQuantityPreviewRepository,
} from "./replenishment-quantity-preview.repository";
import { ReplenishmentQuantityPreviewNotFoundError } from "./replenishment-quantity-preview.errors";

@Injectable()
export class GetReplenishmentQuantityPreviewUseCase {
  constructor(
    @Inject(REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY)
    private readonly repository: ReplenishmentQuantityPreviewRepository,
  ) {}

  async execute(productId: string) {
    const preview = await this.repository.get(productId);
    if (preview === null) throw new ReplenishmentQuantityPreviewNotFoundError(productId);
    return preview;
  }
}
