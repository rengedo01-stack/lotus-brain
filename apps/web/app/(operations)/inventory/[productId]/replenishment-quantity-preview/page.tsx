import { ReplenishmentQuantityPreviewPage } from "../../../_components/replenishment-quantity-preview-page";

export default async function ReplenishmentQuantityPreviewRoutePage({ params }: Readonly<{ params: Promise<{ productId: string }> }>) {
  const { productId } = await params;
  return <ReplenishmentQuantityPreviewPage productId={productId} />;
}
