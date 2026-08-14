import { ProductDetailPage } from "../../../_components/product-detail-page";

export default async function ProductDetailRoutePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductDetailPage productId={id} />;
}
