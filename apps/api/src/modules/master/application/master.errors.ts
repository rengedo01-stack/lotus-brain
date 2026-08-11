export class MasterNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`);
    this.name = "MasterNotFoundError";
  }
}

export class MasterConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterConflictError";
  }
}

export class MasterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterValidationError";
  }
}
