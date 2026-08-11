export class StocktakeNotFoundError extends Error {
  constructor(id: string) {
    super(`Stocktake ${id} was not found.`);
    this.name = "StocktakeNotFoundError";
  }
}

export class StocktakeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StocktakeConflictError";
  }
}

export class InvalidStocktakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStocktakeError";
  }
}
