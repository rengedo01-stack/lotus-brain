import { ProductionDetailPage } from "../../_components/production-workflow";

export default async function ProductionDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductionDetailPage productionId={id} />;
}
