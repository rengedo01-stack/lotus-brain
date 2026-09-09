import { Inject, Injectable } from "@nestjs/common";
import {
  PRODUCTION_LIST_REPOSITORY,
  type ListProductionsQuery,
  type ProductionListRepository,
} from "./production-list.repository";

@Injectable()
export class ListProductionsUseCase {
  constructor(@Inject(PRODUCTION_LIST_REPOSITORY) private readonly repository: ProductionListRepository) {}

  execute(query: ListProductionsQuery) {
    return this.repository.list(query);
  }
}
