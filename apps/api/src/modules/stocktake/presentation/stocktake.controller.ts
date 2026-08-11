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
  @ApiOperation({ summary: "Create a stocktake draft" })
  create(@Body() dto: CreateStocktakeDto) {
    return this.run(() => this.createStocktakeUseCase.execute(dto));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a stocktake" })
  get(@Param("id") id: string) {
    return this.run(() => this.getStocktakeUseCase.execute(id));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a stocktake draft" })
  update(@Param("id") id: string, @Body() dto: UpdateStocktakeDto) {
    return this.run(() => this.updateStocktakeUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @ApiOperation({ summary: "Confirm a stocktake draft" })
  confirm(@Param("id") id: string) {
    return this.run(() => this.confirmStocktakeUseCase.execute(id));
  }

  @Post(":id/post")
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
