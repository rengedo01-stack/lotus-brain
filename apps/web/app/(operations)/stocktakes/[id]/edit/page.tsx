import { StocktakeEditPage } from "../../../_components/stocktake-workflow";

export default async function StocktakeEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <StocktakeEditPage stocktakeId={id} />;
}
