import { Inject, Injectable } from "@nestjs/common";
import { MasterConflictError, MasterNotFoundError } from "./master.errors";
import {
  PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY,
  type OrderingTermsInput,
  type ProductSupplierOrderingTermsRepository,
  type UpdateOrderingTermsInput,
} from "./product-supplier-ordering-terms.repository";
import type { ListQuery } from "./master.repository";

@Injectable()
export class GetProductSupplierOrderingTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY) private readonly repository: ProductSupplierOrderingTermsRepository) {}

  async execute(relationshipId: string) {
    const context = await this.repository.get(relationshipId);
    if (context === null) throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    return context;
  }
}

@Injectable()
export class ListProductSupplierOrderingTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY) private readonly repository: ProductSupplierOrderingTermsRepository) {}

  execute(query: ListQuery) {
    return this.repository.list(query);
  }
}

@Injectable()
export class CreateProductSupplierOrderingTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY) private readonly repository: ProductSupplierOrderingTermsRepository) {}

  async execute(relationshipId: string, input: OrderingTermsInput) {
    const result = await this.repository.create(relationshipId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("Ordering terms already exist or the supply relationship changed. Reload before editing again.");
    return result;
  }
}

@Injectable()
export class UpdateProductSupplierOrderingTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY) private readonly repository: ProductSupplierOrderingTermsRepository) {}

  async execute(relationshipId: string, input: UpdateOrderingTermsInput) {
    const result = await this.repository.update(relationshipId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplierOrderingTerms", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("Ordering terms or the supply relationship changed. Reload before editing again.");
    return result;
  }
}
