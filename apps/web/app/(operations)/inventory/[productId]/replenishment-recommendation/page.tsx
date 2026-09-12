import { ReplenishmentRecommendationPage } from "../../../_components/replenishment-recommendation-page";

export default async function ReplenishmentRecommendationRoutePage({ params }: Readonly<{ params: Promise<{ productId: string }> }>) {
  const { productId } = await params;
  return <ReplenishmentRecommendationPage productId={productId} />;
}
