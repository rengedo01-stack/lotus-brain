export class ReplenishmentRecommendationNotFoundError extends Error {
  constructor(id: string) {
    super(`Replenishment recommendation target ${id} was not found.`);
    this.name = "ReplenishmentRecommendationNotFoundError";
  }
}

export class ReplenishmentRecommendationConflictError extends Error {
  constructor(message = "The replenishment recommendation or its authoritative inputs changed. Reload before continuing.") {
    super(message);
    this.name = "ReplenishmentRecommendationConflictError";
  }
}
