import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { ProductionStatus } from "../../../generated/prisma/client";
import { PostProductionUseCase } from "../application/post-production.use-case";
import { InsufficientProductionInventoryError, InvalidProductionPostingError, ProductionNotFoundError, ProductionPostingConflictError } from "../application/production-posting.errors";
import {
  ConfirmProductionUseCase,
  CreateProductionUseCase,
  GetProductionUseCase,
  UpdateProductionDraftUseCase,
} from "../application/production-lifecycle.use-cases";
import { ListProductionsUseCase } from "../application/list-productions.use-case";
import type { ProductionListCursor } from "../application/production-list.repository";
import {
  ProductionLifecycleConflictError,
  ProductionLifecycleNotFoundError,
  ProductionLifecycleValidationError,
} from "../application/production-lifecycle.errors";
import { CreateProductionDto } from "./dto/create-production.dto";
import { PostProductionDto } from "./dto/post-production.dto";
import { UpdateProductionDto } from "./dto/update-production.dto";
import { postedProductionResponseSchema, productionListPageResponseSchema } from "./production-response.schemas";
import { ListProductionsQueryDto, PRODUCTION_STATUSES } from "./dto/list-productions-query.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

type PostedProductionResponse = {
  actualQuantity: string;
  id: string;
  postedAt: Date;
  status: "POSTED";
};

@ApiTags("productions")
@ApiCookieAuth()
@Controller("productions")
export class ProductionController {
  constructor(
    private readonly postProductionUseCase: PostProductionUseCase,
    private readonly createProductionUseCase: CreateProductionUseCase,
    private readonly getProductionUseCase: GetProductionUseCase,
    private readonly updateProductionDraftUseCase: UpdateProductionDraftUseCase,
    private readonly confirmProductionUseCase: ConfirmProductionUseCase,
    private readonly listProductionsUseCase: ListProductionsUseCase,
  ) {}

  @Get()
  @RequirePermissions(Permissions.PRODUCTION_READ)
  @ApiOperation({ summary: "List productions newest first" })
  @ApiQuery({ name: "status", required: false, enum: PRODUCTION_STATUSES })
  @ApiQuery({ name: "from", required: false, type: String, format: "date-time", description: "Canonical UTC productionDate lower bound (inclusive)." })
  @ApiQuery({ name: "to", required: false, type: String, format: "date-time", description: "Canonical UTC productionDate upper bound (inclusive)." })
  @ApiQuery({ name: "recipeId", required: false, type: String, description: "Exact durable Recipe identifier." })
  @ApiQuery({ name: "outputProductIdSnapshot", required: false, type: String, description: "Exact Production output Product identifier snapshot." })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100, description: "Page size; defaults to 50." })
  @ApiQuery({ name: "cursor", required: false, type: String, description: "Opaque cursor bound to the complete filter set." })
  @ApiOkResponse({ description: "Production summaries were returned newest first.", schema: productionListPageResponseSchema })
  @ApiBadRequestResponse({ description: "The query, canonical UTC date range, or filter-bound cursor is invalid." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "production.read is required." })
  async listProductions(@Query() query: ListProductionsQueryDto) {
    const from = query.from === undefined ? undefined : this.parseCanonicalTimestamp(query.from, "from");
    const to = query.to === undefined ? undefined : this.parseCanonicalTimestamp(query.to, "to");
    if (from !== undefined && to !== undefined && from > to) {
      throw new BadRequestException("from must not be later than to.");
    }
    const cursor = query.cursor === undefined
      ? undefined
      : this.decodeProductionCursor(query.cursor, query.status, from, to, query.recipeId, query.outputProductIdSnapshot);
    const page = await this.listProductionsUseCase.execute({
      status: query.status,
      from,
      to,
      recipeId: query.recipeId,
      outputProductIdSnapshot: query.outputProductIdSnapshot,
      limit: query.limit,
      cursor,
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor === null
        ? null
        : this.encodeProductionCursor(page.nextCursor, query.status, from, to, query.recipeId, query.outputProductIdSnapshot),
    };
  }

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
  @ApiOkResponse({ description: "The production was posted.", schema: postedProductionResponseSchema })
  async postProduction(@Param("id") id: string, @Body() dto: PostProductionDto): Promise<PostedProductionResponse> {
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

  private encodeProductionCursor(
    cursor: ProductionListCursor,
    status: ProductionStatus | undefined,
    from: Date | undefined,
    to: Date | undefined,
    recipeId: string | undefined,
    outputProductIdSnapshot: string | undefined,
  ): string {
    return Buffer.from(JSON.stringify({
      v: 1,
      productionDate: cursor.productionDate.toISOString(),
      id: cursor.id,
      status: status ?? null,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      recipeId: recipeId ?? null,
      outputProductIdSnapshot: outputProductIdSnapshot ?? null,
    } satisfies ProductionCursorPayload)).toString("base64url");
  }

  private decodeProductionCursor(
    value: string,
    status: ProductionStatus | undefined,
    from: Date | undefined,
    to: Date | undefined,
    recipeId: string | undefined,
    outputProductIdSnapshot: string | undefined,
  ): ProductionListCursor {
    const parsed = this.decodeOpaqueCursor(value);
    if (
      !hasExactlyKeys(parsed, ["v", "productionDate", "id", "status", "from", "to", "recipeId", "outputProductIdSnapshot"])
      || parsed.v !== 1
      || !isNonEmptyString(parsed.productionDate)
      || !isNonEmptyString(parsed.id)
      || !isOptionalProductionStatus(parsed.status)
      || !isOptionalString(parsed.from)
      || !isOptionalString(parsed.to)
      || !isOptionalString(parsed.recipeId)
      || !isOptionalString(parsed.outputProductIdSnapshot)
      || parsed.status !== (status ?? null)
      || parsed.from !== (from?.toISOString() ?? null)
      || parsed.to !== (to?.toISOString() ?? null)
      || parsed.recipeId !== (recipeId ?? null)
      || parsed.outputProductIdSnapshot !== (outputProductIdSnapshot ?? null)
    ) {
      throw new BadRequestException("Invalid production cursor.");
    }
    return { productionDate: this.parseCanonicalTimestamp(parsed.productionDate, "cursor"), id: parsed.id };
  }

  private decodeOpaqueCursor(value: string): Record<string, unknown> {
    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new BadRequestException("Invalid production cursor.");
    }
  }

  private parseCanonicalTimestamp(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new BadRequestException(`${field} must be a canonical UTC timestamp.`);
    }
    return parsed;
  }
}

type ProductionCursorPayload = {
  v: 1;
  productionDate: string;
  id: string;
  status: ProductionStatus | null;
  from: string | null;
  to: string | null;
  recipeId: string | null;
  outputProductIdSnapshot: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isOptionalProductionStatus(value: unknown): value is ProductionStatus | null {
  return value === null || PRODUCTION_STATUSES.includes(value as ProductionStatus);
}
