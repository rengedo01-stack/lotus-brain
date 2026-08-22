import { Inject, Injectable } from "@nestjs/common";
import {
  RECIPE_REPOSITORY,
  type RecipeDraftInput,
  type RecipeListQuery,
  type RecipeRepository,
  type RecipeView,
} from "./recipe.repository";
import { RecipeConflictError, RecipeNotFoundError } from "./recipe.errors";

@Injectable()
export class CreateRecipeDraftUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  execute(input: RecipeDraftInput): Promise<RecipeView> {
    return this.repository.createDraft(input);
  }
}

@Injectable()
export class GetRecipeUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  async execute(id: string): Promise<RecipeView> {
    const recipe = await this.repository.get(id);
    if (recipe === null) throw new RecipeNotFoundError();
    return recipe;
  }
}

@Injectable()
export class ListRecipesUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  execute(query: RecipeListQuery): Promise<RecipeView[]> {
    return this.repository.list(query);
  }
}

@Injectable()
export class UpdateRecipeDraftUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  async execute(id: string, input: RecipeDraftInput): Promise<RecipeView> {
    const result = await this.repository.updateDraft(id, input);
    if (result === "NOT_FOUND") throw new RecipeNotFoundError();
    if (result === "CONFLICT") throw new RecipeConflictError("Only an unreferenced DRAFT Recipe can be structurally updated.");
    return result;
  }
}

@Injectable()
export class ActivateRecipeUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  async execute(id: string): Promise<RecipeView> {
    const result = await this.repository.activate(id);
    if (result === "NOT_FOUND") throw new RecipeNotFoundError();
    if (result === "CONFLICT") throw new RecipeConflictError("Only a complete DRAFT Recipe can be activated.");
    return result;
  }
}

@Injectable()
export class ArchiveRecipeUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  async execute(id: string): Promise<RecipeView> {
    const result = await this.repository.archive(id);
    if (result === "NOT_FOUND") throw new RecipeNotFoundError();
    if (result === "CONFLICT") throw new RecipeConflictError("Only an ACTIVE Recipe can be archived.");
    return result;
  }
}

@Injectable()
export class CreateRecipeRevisionUseCase {
  constructor(@Inject(RECIPE_REPOSITORY) private readonly repository: RecipeRepository) {}

  async execute(id: string): Promise<RecipeView> {
    const result = await this.repository.createRevision(id);
    if (result === "NOT_FOUND") throw new RecipeNotFoundError();
    if (result === "CONFLICT") throw new RecipeConflictError("Only an ACTIVE or ARCHIVED Recipe can be revised.");
    return result;
  }
}
