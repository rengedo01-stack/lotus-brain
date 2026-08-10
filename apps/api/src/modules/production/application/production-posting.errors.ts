export class ProductionNotFoundError extends Error {
  constructor(id: string) { super(`Production ${id} was not found.`); }
}

export class ProductionPostingConflictError extends Error {}
export class InvalidProductionPostingError extends Error {}
export class InsufficientProductionInventoryError extends Error {}
