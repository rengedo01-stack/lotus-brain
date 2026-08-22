import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { RecipeConflictError, RecipeNotFoundError, RecipeValidationError } from "../application/recipe.errors";
import {
  ActivateRecipeUseCase,
  ArchiveRecipeUseCase,
  CreateRecipeDraftUseCase,
  CreateRecipeRevisionUseCase,
  GetRecipeUseCase,
  ListRecipesUseCase,
  UpdateRecipeDraftUseCase,
} from "../application/recipe.use-cases";
import { CreateRecipeDto, ListRecipeQueryDto, UpdateRecipeDto } from "./dto/recipe.dto";

@ApiTags("recipes")
@Controller("recipes")
export class RecipeController {
  constructor(
    private readonly createRecipeDraftUseCase: CreateRecipeDraftUseCase,
    private readonly getRecipeUseCase: GetRecipeUseCase,
    private readonly listRecipesUseCase: ListRecipesUseCase,
    private readonly updateRecipeDraftUseCase: UpdateRecipeDraftUseCase,
    private readonly activateRecipeUseCase: ActivateRecipeUseCase,
    private readonly archiveRecipeUseCase: ArchiveRecipeUseCase,
    private readonly createRecipeRevisionUseCase: CreateRecipeRevisionUseCase,
  ) {}

  @Post()
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Create a recipe draft" })
  createRecipe(@Body() dto: CreateRecipeDto) {
    return this.run(() => this.createRecipeDraftUseCase.execute(dto));
  }

  @Get()
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "List recipes" })
  listRecipes(@Query() query: ListRecipeQueryDto) {
    return this.run(() => this.listRecipesUseCase.execute(query));
  }

  @Get(":id")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a recipe" })
  getRecipe(@Param("id") id: string) {
    return this.run(() => this.getRecipeUseCase.execute(id));
  }

  @Patch(":id")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Replace a recipe draft's structure" })
  updateRecipe(@Param("id") id: string, @Body() dto: UpdateRecipeDto) {
    return this.run(() => this.updateRecipeDraftUseCase.execute(id, dto));
  }

  @Post(":id/activate")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Activate a complete recipe draft" })
  activateRecipe(@Param("id") id: string) {
    return this.run(() => this.activateRecipeUseCase.execute(id));
  }

  @Post(":id/archive")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Archive an active recipe" })
  archiveRecipe(@Param("id") id: string) {
    return this.run(() => this.archiveRecipeUseCase.execute(id));
  }

  @Post(":id/revisions")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Clone an active or archived recipe into the next draft revision" })
  createRevision(@Param("id") id: string) {
    return this.run(() => this.createRecipeRevisionUseCase.execute(id));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof RecipeNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof RecipeConflictError) throw new ConflictException(error.message);
      if (error instanceof RecipeValidationError) throw new UnprocessableEntityException(error.message);
      if (this.isPrismaKnownError(error)) {
        if (error.code === "P2002") throw new ConflictException("A Recipe revision already exists.");
        if (["P2003", "P2004", "P2010"].includes(error.code)) {
          throw new UnprocessableEntityException("Recipe master references are no longer valid.");
        }
        if (error.code === "P2025") throw new NotFoundException("Recipe was not found.");
      }
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string";
  }
}
