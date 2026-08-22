import { StocktakeDetailPage } from "../../_components/stocktake-workflow";

export default async function StocktakeDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <StocktakeDetailPage stocktakeId={id} />;
}
