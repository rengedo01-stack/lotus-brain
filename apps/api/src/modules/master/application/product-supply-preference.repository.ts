export type PreferenceMaster = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; isDeleted: boolean };
export type SupplyRelationshipReference = { id: string; status: "ACTIVE" | "DISABLED"; supplier: PreferenceMaster };
export type ProductSupplyPreferenceView = {
  id: string; productId: string; relationshipId: string; version: number; createdAt: Date; updatedAt: Date;
  relationship: SupplyRelationshipReference; isEligible: boolean;
};
export type ProductSupplyPreferenceContext = { product: PreferenceMaster; preference: ProductSupplyPreferenceView | null };

export type PackageReference = {
  id: string; relationshipId: string; code: string; name: string; inventoryQuantityPerPackage: string;
  isOrderable: boolean; status: "ACTIVE" | "DISABLED";
};
export type PackagePreferenceRelationship = SupplyRelationshipReference & { product: PreferenceMaster };
export type ProductSupplierPackagePreferenceView = {
  id: string; relationshipId: string; packageId: string; version: number; createdAt: Date; updatedAt: Date;
  package: PackageReference; isEligible: boolean;
};
export type ProductSupplierPackagePreferenceContext = {
  relationship: PackagePreferenceRelationship; preference: ProductSupplierPackagePreferenceView | null;
};

export type SetProductSupplyPreferenceInput = { relationshipId: string; expectedVersion: number | null };
export type SetProductSupplierPackagePreferenceInput = { packageId: string; expectedVersion: number | null };

export interface ProductSupplyPreferenceRepository {
  getProductPreference(productId: string): Promise<ProductSupplyPreferenceContext | null>;
  setProductPreference(productId: string, input: SetProductSupplyPreferenceInput): Promise<ProductSupplyPreferenceContext | "NOT_FOUND" | "CONFLICT">;
  clearProductPreference(productId: string, expectedVersion: number): Promise<ProductSupplyPreferenceContext | "NOT_FOUND" | "CONFLICT">;
  getPackagePreference(relationshipId: string): Promise<ProductSupplierPackagePreferenceContext | null>;
  setPackagePreference(relationshipId: string, input: SetProductSupplierPackagePreferenceInput): Promise<ProductSupplierPackagePreferenceContext | "NOT_FOUND" | "CONFLICT">;
  clearPackagePreference(relationshipId: string, expectedVersion: number): Promise<ProductSupplierPackagePreferenceContext | "NOT_FOUND" | "CONFLICT">;
}

export const PRODUCT_SUPPLY_PREFERENCE_REPOSITORY = Symbol("PRODUCT_SUPPLY_PREFERENCE_REPOSITORY");
