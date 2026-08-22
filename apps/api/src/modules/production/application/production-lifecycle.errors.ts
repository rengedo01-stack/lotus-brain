export class ProductionLifecycleNotFoundError extends Error {
  constructor(id: string) {
    super(`Production ${id} was not found.`);
  }
}

export class ProductionLifecycleConflictError extends Error {}
export class ProductionLifecycleValidationError extends Error {}
