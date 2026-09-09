import { Inject, Injectable } from "@nestjs/common";
import {
  INVENTORY_READ_REPOSITORY,
  type InventoryReadRepository,
  type ListCurrentInventoryQuery,
  type ListInventoryHistoryQuery,
} from "./inventory-read.repository";
import { InventoryReadNotFoundError } from "./inventory-read.errors";

@Injectable()
export class ListCurrentInventoryUseCase {
  constructor(@Inject(INVENTORY_READ_REPOSITORY) private readonly repository: InventoryReadRepository) {}

  execute(query: ListCurrentInventoryQuery) {
    return this.repository.listCurrentInventory(query);
  }
}

@Injectable()
export class ListInventorySupplyContextUseCase {
  constructor(@Inject(INVENTORY_READ_REPOSITORY) private readonly repository: InventoryReadRepository) {}

  execute(query: ListCurrentInventoryQuery) {
    return this.repository.listSupplyContext(query);
  }
}

@Injectable()
export class ListInventoryHistoryUseCase {
  constructor(@Inject(INVENTORY_READ_REPOSITORY) private readonly repository: InventoryReadRepository) {}

  async execute(query: ListInventoryHistoryQuery) {
    const page = await this.repository.listInventoryHistory(query);
    if (page === null) throw new InventoryReadNotFoundError(query.productId);
    return page;
  }
}
