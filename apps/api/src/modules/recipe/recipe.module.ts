import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { RECIPE_REPOSITORY } from "./application/recipe.repository";
import {
  ActivateRecipeUseCase,
  ArchiveRecipeUseCase,
  CreateRecipeDraftUseCase,
  CreateRecipeRevisionUseCase,
  GetRecipeUseCase,
  ListRecipesUseCase,
  UpdateRecipeDraftUseCase,
} from "./application/recipe.use-cases";
import { PrismaRecipeRepository } from "./infrastructure/prisma-recipe.repository";
import { RecipeController } from "./presentation/recipe.controller";

@Module({
  imports: [PrismaModule],
  controllers: [RecipeController],
  providers: [
    CreateRecipeDraftUseCase,
    GetRecipeUseCase,
    ListRecipesUseCase,
    UpdateRecipeDraftUseCase,
    ActivateRecipeUseCase,
    ArchiveRecipeUseCase,
    CreateRecipeRevisionUseCase,
    { provide: RECIPE_REPOSITORY, useClass: PrismaRecipeRepository },
  ],
})
export class RecipeModule {}
