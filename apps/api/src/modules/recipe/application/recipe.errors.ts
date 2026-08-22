export class RecipeNotFoundError extends Error {
  constructor() {
    super("Recipe was not found.");
  }
}

export class RecipeConflictError extends Error {}

export class RecipeValidationError extends Error {}
