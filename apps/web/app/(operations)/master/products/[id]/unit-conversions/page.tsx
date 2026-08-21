import { ProductConversionsPage } from "../../../../_components/product-conversions-page";

export default async function ProductConversionsRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductConversionsPage productId={id} />;
}
