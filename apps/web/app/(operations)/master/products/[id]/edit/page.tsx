import { ProductEditPage } from "../../../../_components/product-forms";

export default async function ProductEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductEditPage productId={id} />;
}
