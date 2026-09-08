import { Inject, Injectable } from "@nestjs/common";
import {
  PURCHASE_LIST_REPOSITORY,
  type ListPurchasesQuery,
  type PurchaseListRepository,
} from "./purchase-list.repository";

@Injectable()
export class ListPurchasesUseCase {
  constructor(@Inject(PURCHASE_LIST_REPOSITORY) private readonly repository: PurchaseListRepository) {}

  execute(query: ListPurchasesQuery) {
    return this.repository.list(query);
  }
}
