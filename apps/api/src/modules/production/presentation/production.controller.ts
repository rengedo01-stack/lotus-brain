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
import { PostProductionUseCase } from "../application/post-production.use-case";
import { InsufficientProductionInventoryError, InvalidProductionPostingError, ProductionNotFoundError, ProductionPostingConflictError } from "../application/production-posting.errors";
import {
  ConfirmProductionUseCase,
  CreateProductionUseCase,
  GetProductionUseCase,
  UpdateProductionDraftUseCase,
} from "../application/production-lifecycle.use-cases";
import {
  ProductionLifecycleConflictError,
  ProductionLifecycleNotFoundError,
  ProductionLifecycleValidationError,
} from "../application/production-lifecycle.errors";
import { CreateProductionDto } from "./dto/create-production.dto";
import { PostProductionDto } from "./dto/post-production.dto";
import { UpdateProductionDto } from "./dto/update-production.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

@ApiTags("productions")
@Controller("productions")
export class ProductionController {
  constructor(
    private readonly postProductionUseCase: PostProductionUseCase,
    private readonly createProductionUseCase: CreateProductionUseCase,
    private readonly getProductionUseCase: GetProductionUseCase,
    private readonly updateProductionDraftUseCase: UpdateProductionDraftUseCase,
    private readonly confirmProductionUseCase: ConfirmProductionUseCase,
  ) {}

  @Post()
  @RequirePermissions(Permissions.PRODUCTION_WRITE)
  @ApiOperation({ summary: "Create a Production from an ACTIVE Recipe" })
  createProduction(@Body() dto: CreateProductionDto) {
    return this.runLifecycle(() => this.createProductionUseCase.execute(dto));
  }

  @Get(":id")
  @RequirePermissions(Permissions.PRODUCTION_READ)
  @ApiOperation({ summary: "Get a Production and its immutable snapshots" })
  getProduction(@Param("id") id: string) {
    return this.runLifecycle(() => this.getProductionUseCase.execute(id));
  }

  @Patch(":id")
  @RequirePermissions(Permissions.PRODUCTION_WRITE)
  @ApiOperation({ summary: "Update the allowlisted fields of a DRAFT Production" })
  updateProduction(@Param("id") id: string, @Body() dto: UpdateProductionDto) {
    return this.runLifecycle(() => this.updateProductionDraftUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @RequirePermissions(Permissions.PRODUCTION_CONFIRM)
  @ApiOperation({ summary: "Confirm a DRAFT Production" })
  confirmProduction(@Param("id") id: string) {
    return this.runLifecycle(() => this.confirmProductionUseCase.execute(id));
  }

  @Post(":id/post")
  @RequirePermissions(Permissions.PRODUCTION_POST)
  @HttpCode(200)
  @ApiOperation({ summary: "Post a confirmed Production and apply stock and cost effects" })
  @ApiOkResponse({ description: "The production was posted." })
  async postProduction(@Param("id") id: string, @Body() dto: PostProductionDto) {
    try { return await this.postProductionUseCase.execute(id, dto.actualQuantity); }
    catch (error: unknown) {
      if (error instanceof ProductionNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ProductionPostingConflictError) throw new ConflictException(error.message);
      if (error instanceof InvalidProductionPostingError || error instanceof InsufficientProductionInventoryError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  private async runLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof ProductionLifecycleNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ProductionLifecycleConflictError) throw new ConflictException(error.message);
      if (error instanceof ProductionLifecycleValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
