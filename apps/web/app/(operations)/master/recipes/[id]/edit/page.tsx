import { RecipeEditPage } from "../../../../_components/recipe-management";

export default async function RecipeEditRoutePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) { const { id } = await params; return <RecipeEditPage recipeId={id} />; }
