import { ProductSupplyRelationshipDetailPage } from "../../../_components/product-supply-relationship-management";

export default async function ProductSupplyRelationshipDetailRoutePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductSupplyRelationshipDetailPage relationshipId={id} />;
}
