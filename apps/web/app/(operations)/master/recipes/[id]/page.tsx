import { RecipeDetailPage } from "../../../_components/recipe-management";

export default async function RecipeDetailRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) { const { id } = await params; return <RecipeDetailPage recipeId={id} />; }
