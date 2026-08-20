import { SupplierEditPage } from "../../../../_components/supplier-management";

export default async function SupplierEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <SupplierEditPage supplierId={id} />;
}
