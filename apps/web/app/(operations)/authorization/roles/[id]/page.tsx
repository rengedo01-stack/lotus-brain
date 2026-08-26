import { AuthorizationRoleDetailPage } from "../../../_components/authorization-management";

export default async function AuthorizationRoleDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <AuthorizationRoleDetailPage roleId={id} />;
}
