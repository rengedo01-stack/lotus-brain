import { UnitEditPage } from "../../../../_components/unit-management";

export default async function UnitEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <UnitEditPage unitId={id} />;
}
