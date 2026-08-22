import { PurchaseEditPage } from "../../../_components/purchase-workflow";

export default async function PurchaseEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PurchaseEditPage purchaseId={id} />;
}
