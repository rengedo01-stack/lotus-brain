import { Inject, Injectable } from "@nestjs/common";
import { MasterConflictError, MasterNotFoundError } from "./master.errors";
import {
  PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY,
  type CommercialTermsInput,
  type ProductSupplierCommercialTermsRepository,
  type UpdateCommercialTermsInput,
} from "./product-supplier-commercial-terms.repository";

@Injectable()
export class GetProductSupplierCommercialTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY) private readonly repository: ProductSupplierCommercialTermsRepository) {}

  async execute(relationshipId: string) {
    const context = await this.repository.get(relationshipId);
    if (context === null) throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    return context;
  }
}

@Injectable()
export class CreateProductSupplierCommercialTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY) private readonly repository: ProductSupplierCommercialTermsRepository) {}

  async execute(relationshipId: string, input: CommercialTermsInput) {
    const result = await this.repository.create(relationshipId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("Commercial terms already exist or the supply relationship is not currently eligible. Reload before editing again.");
    return result;
  }
}

@Injectable()
export class UpdateProductSupplierCommercialTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY) private readonly repository: ProductSupplierCommercialTermsRepository) {}

  async execute(relationshipId: string, input: UpdateCommercialTermsInput) {
    const result = await this.repository.update(relationshipId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplierCommercialTerms", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("Commercial terms or the supply relationship changed. Reload before editing again.");
    return result;
  }
}

@Injectable()
export class ClearProductSupplierCommercialTermsUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY) private readonly repository: ProductSupplierCommercialTermsRepository) {}

  async execute(relationshipId: string, expectedVersion: number) {
    const result = await this.repository.clear(relationshipId, expectedVersion);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("Commercial terms changed or are not configured. Reload before editing again.");
    return result;
  }
}
