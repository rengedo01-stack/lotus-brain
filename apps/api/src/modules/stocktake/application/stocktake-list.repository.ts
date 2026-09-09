import type { StocktakeStatus } from "../../../generated/prisma/client";

/**
 * A deliberately header-only operational projection. Product, Inventory, and
 * StocktakeItem data are not joined or published by the collection endpoint.
 */
export type StocktakeListItemView = {
  id: string;
  status: StocktakeStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StocktakeListCursor = {
  createdAt: Date;
  id: string;
};

export type ListStocktakesQuery = {
  status?: StocktakeStatus;
  createdFrom?: Date;
  createdTo?: Date;
  limit: number;
  cursor?: StocktakeListCursor;
};

export type StocktakeListPage = {
  items: StocktakeListItemView[];
  nextCursor: StocktakeListCursor | null;
};

export interface StocktakeListRepository {
  list(query: ListStocktakesQuery): Promise<StocktakeListPage>;
}

export const STOCKTAKE_LIST_REPOSITORY = Symbol("STOCKTAKE_LIST_REPOSITORY");
