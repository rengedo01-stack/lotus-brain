import { Inject, Injectable } from "@nestjs/common";
import { MasterConflictError, MasterNotFoundError } from "./master.errors";
import { PRODUCT_SUPPLY_PREFERENCE_REPOSITORY, type ProductSupplyPreferenceRepository, type SetProductSupplierPackagePreferenceInput, type SetProductSupplyPreferenceInput } from "./product-supply-preference.repository";

function unwrap<T>(result: T | "NOT_FOUND" | "CONFLICT", name: string): T {
  if (result === "NOT_FOUND") throw new MasterNotFoundError(name, "requested");
  if (result === "CONFLICT") throw new MasterConflictError("The preference or its selected master state changed. Reload before editing again.");
  return result;
}

@Injectable()
export class ProductSupplyPreferenceUseCases {
  constructor(@Inject(PRODUCT_SUPPLY_PREFERENCE_REPOSITORY) private readonly repository: ProductSupplyPreferenceRepository) {}
  async getProduct(productId: string) { const r = await this.repository.getProductPreference(productId); if (r === null) throw new MasterNotFoundError("Product", productId); return r; }
  async setProduct(productId: string, input: SetProductSupplyPreferenceInput) { return unwrap(await this.repository.setProductPreference(productId, input), "Product"); }
  async clearProduct(productId: string, expectedVersion: number) { return unwrap(await this.repository.clearProductPreference(productId, expectedVersion), "Product"); }
  async getPackage(relationshipId: string) { const r = await this.repository.getPackagePreference(relationshipId); if (r === null) throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId); return r; }
  async setPackage(relationshipId: string, input: SetProductSupplierPackagePreferenceInput) { return unwrap(await this.repository.setPackagePreference(relationshipId, input), "ProductSupplyRelationship"); }
  async clearPackage(relationshipId: string, expectedVersion: number) { return unwrap(await this.repository.clearPackagePreference(relationshipId, expectedVersion), "ProductSupplyRelationship"); }
}
