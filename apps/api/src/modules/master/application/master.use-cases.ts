import { Inject, Injectable } from "@nestjs/common";
import {
  MASTER_REPOSITORY,
  type ListQuery,
  type MasterRepository,
  type ProductInput,
  type ProductUpdateInput,
  type SupplierInput,
  type SupplierUpdateInput,
  type UnitInput,
  type UnitUpdateInput,
} from "./master.repository";
import { MasterNotFoundError } from "./master.errors";

@Injectable()
export class CreateProductUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(input: ProductInput) {
    return this.repository.createProduct(input);
  }
}

@Injectable()
export class GetProductUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string) {
    const product = await this.repository.getProduct(id);
    if (product === null) throw new MasterNotFoundError("Product", id);
    return product;
  }
}

@Injectable()
export class ListProductsUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(query: ListQuery) {
    return this.repository.listProducts(query);
  }
}

@Injectable()
export class UpdateProductUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string, input: ProductUpdateInput) {
    const product = await this.repository.updateProduct(id, input);
    if (product === "NOT_FOUND") throw new MasterNotFoundError("Product", id);
    return product;
  }
}

@Injectable()
export class CreateUnitUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(input: UnitInput) {
    return this.repository.createUnit(input);
  }
}

@Injectable()
export class GetUnitUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string) {
    const unit = await this.repository.getUnit(id);
    if (unit === null) throw new MasterNotFoundError("Unit", id);
    return unit;
  }
}

@Injectable()
export class ListUnitsUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(query: ListQuery) {
    return this.repository.listUnits(query);
  }
}

@Injectable()
export class UpdateUnitUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string, input: UnitUpdateInput) {
    const unit = await this.repository.updateUnit(id, input);
    if (unit === "NOT_FOUND") throw new MasterNotFoundError("Unit", id);
    return unit;
  }
}

@Injectable()
export class CreateSupplierUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(input: SupplierInput) {
    return this.repository.createSupplier(input);
  }
}

@Injectable()
export class GetSupplierUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string) {
    const supplier = await this.repository.getSupplier(id);
    if (supplier === null) throw new MasterNotFoundError("Supplier", id);
    return supplier;
  }
}

@Injectable()
export class ListSuppliersUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  execute(query: ListQuery) {
    return this.repository.listSuppliers(query);
  }
}

@Injectable()
export class UpdateSupplierUseCase {
  constructor(@Inject(MASTER_REPOSITORY) private readonly repository: MasterRepository) {}
  async execute(id: string, input: SupplierUpdateInput) {
    const supplier = await this.repository.updateSupplier(id, input);
    if (supplier === "NOT_FOUND") throw new MasterNotFoundError("Supplier", id);
    return supplier;
  }
}
