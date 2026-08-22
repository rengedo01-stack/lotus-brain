import { PurchaseDetailPage } from "../../_components/purchase-workflow";

export default async function PurchaseDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PurchaseDetailPage purchaseId={id} />;
}
