import type { ProductionStatus } from "../../../generated/prisma/client";

/**
 * Narrow operational projection. Product and Recipe masters are deliberately
 * not joined: these durable identifiers are the data stored by Production.
 */
export type ProductionListItemView = {
  id: string;
  status: ProductionStatus;
  productionDate: Date;
  outputProductIdSnapshot: string;
  recipe: { id: string; rootRecipeId: string; revision: number };
  postedAt: Date | null;
  cancelledAt: Date | null;
};

export type ProductionListCursor = {
  productionDate: Date;
  id: string;
};

export type ListProductionsQuery = {
  status?: ProductionStatus;
  from?: Date;
  to?: Date;
  recipeId?: string;
  outputProductIdSnapshot?: string;
  limit: number;
  cursor?: ProductionListCursor;
};

export type ProductionListPage = {
  items: ProductionListItemView[];
  nextCursor: ProductionListCursor | null;
};

export interface ProductionListRepository {
  list(query: ListProductionsQuery): Promise<ProductionListPage>;
}

export const PRODUCTION_LIST_REPOSITORY = Symbol("PRODUCTION_LIST_REPOSITORY");
