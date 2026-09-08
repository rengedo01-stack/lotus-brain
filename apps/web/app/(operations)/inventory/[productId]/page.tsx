import { InventoryHistoryPage } from "../../_components/inventory-visibility";
export default async function InventoryHistoryRoutePage({ params }: Readonly<{ params: Promise<{ productId: string }> }>) { const { productId } = await params; return <InventoryHistoryPage productId={productId} />; }
