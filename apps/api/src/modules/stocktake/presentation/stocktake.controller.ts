import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InvalidStocktakeError, StocktakeConflictError, StocktakeNotFoundError } from "../application/stocktake.errors";
import { ConfirmStocktakeUseCase, CreateStocktakeUseCase, GetStocktakeUseCase, PostStocktakeUseCase, UpdateStocktakeUseCase } from "../application/stocktake.use-cases";
import { CreateStocktakeDto } from "./dto/create-stocktake.dto";
import { UpdateStocktakeDto } from "./dto/update-stocktake.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

@ApiTags("stocktakes")
@Controller("stocktakes")
export class StocktakeController {
  constructor(
    private readonly createStocktakeUseCase: CreateStocktakeUseCase,
    private readonly getStocktakeUseCase: GetStocktakeUseCase,
    private readonly updateStocktakeUseCase: UpdateStocktakeUseCase,
    private readonly confirmStocktakeUseCase: ConfirmStocktakeUseCase,
    private readonly postStocktakeUseCase: PostStocktakeUseCase,
  ) {}

  @Post()
  @RequirePermissions(Permissions.STOCKTAKE_WRITE)
  @ApiOperation({ summary: "Create a stocktake draft" })
  create(@Body() dto: CreateStocktakeDto) {
    return this.run(() => this.createStocktakeUseCase.execute(dto));
  }

  @Get(":id")
  @RequirePermissions(Permissions.STOCKTAKE_READ)
  @ApiOperation({ summary: "Get a stocktake" })
  get(@Param("id") id: string) {
    return this.run(() => this.getStocktakeUseCase.execute(id));
  }

  @Patch(":id")
  @RequirePermissions(Permissions.STOCKTAKE_WRITE)
  @ApiOperation({ summary: "Update a stocktake draft" })
  update(@Param("id") id: string, @Body() dto: UpdateStocktakeDto) {
    return this.run(() => this.updateStocktakeUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @RequirePermissions(Permissions.STOCKTAKE_CONFIRM)
  @ApiOperation({ summary: "Confirm a stocktake draft" })
  confirm(@Param("id") id: string) {
    return this.run(() => this.confirmStocktakeUseCase.execute(id));
  }

  @Post(":id/post")
  @RequirePermissions(Permissions.STOCKTAKE_POST)
  @HttpCode(200)
  @ApiOperation({ summary: "Post a confirmed stocktake" })
  @ApiOkResponse({ description: "The stocktake was posted." })
  post(@Param("id") id: string) {
    return this.run(() => this.postStocktakeUseCase.execute(id));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof StocktakeNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof StocktakeConflictError) throw new ConflictException(error.message);
      if (error instanceof InvalidStocktakeError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
