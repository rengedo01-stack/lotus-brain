import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { StocktakeStatus } from "../../../generated/prisma/client";
import { InvalidStocktakeError, StocktakeConflictError, StocktakeNotFoundError } from "../application/stocktake.errors";
import { ConfirmStocktakeUseCase, CreateStocktakeUseCase, GetStocktakeUseCase, PostStocktakeUseCase, UpdateStocktakeUseCase } from "../application/stocktake.use-cases";
import { ListStocktakesUseCase } from "../application/list-stocktakes.use-case";
import type { StocktakeListCursor } from "../application/stocktake-list.repository";
import { CreateStocktakeDto } from "./dto/create-stocktake.dto";
import { ListStocktakesQueryDto, STOCKTAKE_STATUSES } from "./dto/list-stocktakes-query.dto";
import { UpdateStocktakeDto } from "./dto/update-stocktake.dto";
import { postedStocktakeResponseSchema } from "./stocktake-response.schemas";
import { stocktakeListPageResponseSchema } from "./stocktake-list-response.schemas";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

type PostedStocktakeResponse = {
  completedAt: Date;
  id: string;
  status: "POSTED";
};

@ApiTags("stocktakes")
@ApiCookieAuth()
@Controller("stocktakes")
export class StocktakeController {
  constructor(
    private readonly createStocktakeUseCase: CreateStocktakeUseCase,
    private readonly getStocktakeUseCase: GetStocktakeUseCase,
    private readonly updateStocktakeUseCase: UpdateStocktakeUseCase,
    private readonly confirmStocktakeUseCase: ConfirmStocktakeUseCase,
    private readonly postStocktakeUseCase: PostStocktakeUseCase,
    private readonly listStocktakesUseCase: ListStocktakesUseCase,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.STOCKTAKE_READ)
  @ApiOperation({ summary: "List stocktakes newest created first" })
  @ApiQuery({ name: "status", required: false, enum: STOCKTAKE_STATUSES })
  @ApiQuery({ name: "createdFrom", required: false, type: String, format: "date-time", description: "Canonical UTC creation timestamp lower bound (inclusive)." })
  @ApiQuery({ name: "createdTo", required: false, type: String, format: "date-time", description: "Canonical UTC creation timestamp upper bound (inclusive)." })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100, description: "Page size; defaults to 50." })
  @ApiQuery({ name: "cursor", required: false, type: String, description: "Opaque cursor bound to the complete filter set." })
  @ApiOkResponse({ description: "Stocktake headers were returned newest created first.", schema: stocktakeListPageResponseSchema })
  @ApiBadRequestResponse({ description: "The query, canonical UTC date range, or filter-bound cursor is invalid." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "stocktake.read is required." })
  async list(@Query() query: ListStocktakesQueryDto) {
    const createdFrom = query.createdFrom === undefined ? undefined : this.parseCanonicalTimestamp(query.createdFrom, "createdFrom");
    const createdTo = query.createdTo === undefined ? undefined : this.parseCanonicalTimestamp(query.createdTo, "createdTo");
    if (createdFrom !== undefined && createdTo !== undefined && createdFrom > createdTo) {
      throw new BadRequestException("createdFrom must not be later than createdTo.");
    }
    const cursor = query.cursor === undefined
      ? undefined
      : this.decodeStocktakeCursor(query.cursor, query.status, createdFrom, createdTo);
    const page = await this.listStocktakesUseCase.execute({ status: query.status, createdFrom, createdTo, limit: query.limit, cursor });
    return {
      items: page.items,
      nextCursor: page.nextCursor === null
        ? null
        : this.encodeStocktakeCursor(page.nextCursor, query.status, createdFrom, createdTo),
    };
  }

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
  @ApiOkResponse({ description: "The stocktake was posted.", schema: postedStocktakeResponseSchema })
  post(@Param("id") id: string): Promise<PostedStocktakeResponse> {
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

  private encodeStocktakeCursor(
    cursor: StocktakeListCursor,
    status: StocktakeStatus | undefined,
    createdFrom: Date | undefined,
    createdTo: Date | undefined,
  ): string {
    return Buffer.from(JSON.stringify({
      v: 1,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
      status: status ?? null,
      createdFrom: createdFrom?.toISOString() ?? null,
      createdTo: createdTo?.toISOString() ?? null,
    } satisfies StocktakeCursorPayload)).toString("base64url");
  }

  private decodeStocktakeCursor(
    value: string,
    status: StocktakeStatus | undefined,
    createdFrom: Date | undefined,
    createdTo: Date | undefined,
  ): StocktakeListCursor {
    const parsed = this.decodeOpaqueCursor(value);
    if (
      !hasExactlyKeys(parsed, ["v", "createdAt", "id", "status", "createdFrom", "createdTo"])
      || parsed.v !== 1
      || !isNonEmptyString(parsed.createdAt)
      || !isNonEmptyString(parsed.id)
      || !isOptionalStocktakeStatus(parsed.status)
      || !isOptionalString(parsed.createdFrom)
      || !isOptionalString(parsed.createdTo)
      || parsed.status !== (status ?? null)
      || parsed.createdFrom !== (createdFrom?.toISOString() ?? null)
      || parsed.createdTo !== (createdTo?.toISOString() ?? null)
    ) {
      throw new BadRequestException("Invalid stocktake cursor.");
    }
    return { createdAt: this.parseCanonicalTimestamp(parsed.createdAt, "cursor"), id: parsed.id };
  }

  private decodeOpaqueCursor(value: string): Record<string, unknown> {
    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new BadRequestException("Invalid stocktake cursor.");
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

type StocktakeCursorPayload = {
  v: 1;
  createdAt: string;
  id: string;
  status: StocktakeStatus | null;
  createdFrom: string | null;
  createdTo: string | null;
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

function isOptionalStocktakeStatus(value: unknown): value is StocktakeStatus | null {
  return value === null || STOCKTAKE_STATUSES.includes(value as StocktakeStatus);
}
