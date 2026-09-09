import { ReplenishmentPolicyPage } from "../../../../_components/replenishment-policy-page";

export default async function ReplenishmentPolicyRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ReplenishmentPolicyPage productId={id} />;
}
