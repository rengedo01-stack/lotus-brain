import { ProductionEditPage } from "../../../_components/production-workflow";

export default async function ProductionEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductionEditPage productionId={id} />;
}
