import { Inject, Injectable } from "@nestjs/common";
import {
  STOCKTAKE_LIST_REPOSITORY,
  type ListStocktakesQuery,
  type StocktakeListRepository,
} from "./stocktake-list.repository";

@Injectable()
export class ListStocktakesUseCase {
  constructor(@Inject(STOCKTAKE_LIST_REPOSITORY) private readonly repository: StocktakeListRepository) {}

  execute(query: ListStocktakesQuery) {
    return this.repository.list(query);
  }
}
