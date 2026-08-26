import { IdentityUserDetailPage } from "../../../_components/identity-management";

export default async function IdentityUserDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <IdentityUserDetailPage key={id} userId={id} />;
}
