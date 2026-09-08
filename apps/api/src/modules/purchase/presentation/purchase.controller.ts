import {
  ConflictException,
  BadRequestException,
  Body,
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
import type { PurchaseStatus } from "../../../generated/prisma/client";
import {
  InvalidPurchaseItemError,
  InventoryValuationUnavailableError,
  PurchaseNotFoundError,
  PurchasePostingConflictError,
} from "../application/purchase-posting.errors";
import { PostPurchaseUseCase } from "../application/post-purchase.use-case";
import {
  ConfirmPurchaseUseCase,
  CreatePurchaseDraftUseCase,
  GetPurchaseUseCase,
  UpdatePurchaseDraftUseCase,
} from "../application/purchase-draft.use-cases";
import { ListPurchasesUseCase } from "../application/list-purchases.use-case";
import type { PurchaseListCursor } from "../application/purchase-list.repository";
import {
  PurchaseDraftConflictError,
  PurchaseDraftNotFoundError,
  PurchaseDraftValidationError,
} from "../application/purchase-draft.errors";
import { CreatePurchaseDto } from "./dto/create-purchase.dto";
import { UpdatePurchaseDto } from "./dto/update-purchase.dto";
import { postedPurchaseResponseSchema, purchaseListPageResponseSchema } from "./purchase-response.schemas";
import { ListPurchasesQueryDto, PURCHASE_STATUSES } from "./dto/list-purchases-query.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";

type PostedPurchaseResponse = {
  id: string;
  status: "POSTED";
  postedAt: Date;
};

@ApiTags("purchases")
@ApiCookieAuth()
@Controller("purchases")
export class PurchaseController {
  constructor(
    private readonly postPurchaseUseCase: PostPurchaseUseCase,
    private readonly createPurchaseDraftUseCase: CreatePurchaseDraftUseCase,
    private readonly getPurchaseUseCase: GetPurchaseUseCase,
    private readonly updatePurchaseDraftUseCase: UpdatePurchaseDraftUseCase,
    private readonly confirmPurchaseUseCase: ConfirmPurchaseUseCase,
    private readonly listPurchasesUseCase: ListPurchasesUseCase,
  ) {}

  @Get()
  @RequirePermissions(Permissions.PURCHASE_READ)
  @ApiOperation({ summary: "List purchases newest first" })
  @ApiQuery({ name: "status", required: false, enum: PURCHASE_STATUSES })
  @ApiQuery({ name: "from", required: false, type: String, format: "date-time", description: "Canonical UTC purchaseDate lower bound (inclusive)." })
  @ApiQuery({ name: "to", required: false, type: String, format: "date-time", description: "Canonical UTC purchaseDate upper bound (inclusive)." })
  @ApiQuery({ name: "supplierCode", required: false, type: String, description: "Exact supplier code." })
  @ApiQuery({ name: "documentNumber", required: false, type: String, description: "Exact document number." })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100, description: "Page size; defaults to 50." })
  @ApiQuery({ name: "cursor", required: false, type: String, description: "Opaque cursor bound to the complete filter set." })
  @ApiOkResponse({ description: "Purchase summaries were returned newest first.", schema: purchaseListPageResponseSchema })
  @ApiBadRequestResponse({ description: "The query, canonical UTC date range, or filter-bound cursor is invalid." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.read is required." })
  async listPurchases(@Query() query: ListPurchasesQueryDto) {
    const from = query.from === undefined ? undefined : this.parseCanonicalTimestamp(query.from, "from");
    const to = query.to === undefined ? undefined : this.parseCanonicalTimestamp(query.to, "to");
    if (from !== undefined && to !== undefined && from > to) {
      throw new BadRequestException("from must not be later than to.");
    }
    const cursor = query.cursor === undefined
      ? undefined
      : this.decodePurchaseCursor(query.cursor, query.status, from, to, query.supplierCode, query.documentNumber);
    const page = await this.listPurchasesUseCase.execute({
      status: query.status,
      from,
      to,
      supplierCode: query.supplierCode,
      documentNumber: query.documentNumber,
      limit: query.limit,
      cursor,
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor === null
        ? null
        : this.encodePurchaseCursor(page.nextCursor, query.status, from, to, query.supplierCode, query.documentNumber),
    };
  }

  @Post()
  @RequirePermissions(Permissions.PURCHASE_WRITE)
  @ApiOperation({ summary: "Create a purchase draft" })
  createPurchase(@Body() dto: CreatePurchaseDto) {
    return this.runDraft(() => this.createPurchaseDraftUseCase.execute(dto));
  }

  @Get(":id")
  @RequirePermissions(Permissions.PURCHASE_READ)
  @ApiOperation({ summary: "Get a purchase" })
  getPurchase(@Param("id") id: string) {
    return this.runDraft(() => this.getPurchaseUseCase.execute(id));
  }

  @Patch(":id")
  @RequirePermissions(Permissions.PURCHASE_WRITE)
  @ApiOperation({ summary: "Update a purchase draft" })
  updatePurchase(@Param("id") id: string, @Body() dto: UpdatePurchaseDto) {
    return this.runDraft(() => this.updatePurchaseDraftUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @RequirePermissions(Permissions.PURCHASE_CONFIRM)
  @ApiOperation({ summary: "Confirm a purchase draft" })
  confirmPurchase(@Param("id") id: string) {
    return this.runDraft(() => this.confirmPurchaseUseCase.execute(id));
  }

  @Post(":id/post")
  @RequirePermissions(Permissions.PURCHASE_POST)
  @HttpCode(200)
  @ApiOperation({ summary: "Post a purchase and apply its price and inventory effects" })
  @ApiOkResponse({ description: "The purchase was posted.", schema: postedPurchaseResponseSchema })
  async postPurchase(@Param("id") purchaseId: string): Promise<PostedPurchaseResponse> {
    try {
      return await this.postPurchaseUseCase.execute(purchaseId);
    } catch (error: unknown) {
      if (error instanceof PurchaseNotFoundError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof PurchasePostingConflictError) {
        throw new ConflictException(error.message);
      }

      if (
        error instanceof InvalidPurchaseItemError ||
        error instanceof InventoryValuationUnavailableError
      ) {
        throw new UnprocessableEntityException(error.message);
      }

      throw error;
    }
  }

  private async runDraft<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof PurchaseDraftNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PurchaseDraftConflictError) throw new ConflictException(error.message);
      if (error instanceof PurchaseDraftValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  private encodePurchaseCursor(
    cursor: PurchaseListCursor,
    status: PurchaseStatus | undefined,
    from: Date | undefined,
    to: Date | undefined,
    supplierCode: string | undefined,
    documentNumber: string | undefined,
  ): string {
    return Buffer.from(JSON.stringify({
      v: 1,
      purchaseDate: cursor.purchaseDate.toISOString(),
      id: cursor.id,
      status: status ?? null,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      supplierCode: supplierCode ?? null,
      documentNumber: documentNumber ?? null,
    } satisfies PurchaseCursorPayload)).toString("base64url");
  }

  private decodePurchaseCursor(
    value: string,
    status: PurchaseStatus | undefined,
    from: Date | undefined,
    to: Date | undefined,
    supplierCode: string | undefined,
    documentNumber: string | undefined,
  ): PurchaseListCursor {
    const parsed = this.decodeOpaqueCursor(value);
    if (
      !hasExactlyKeys(parsed, ["v", "purchaseDate", "id", "status", "from", "to", "supplierCode", "documentNumber"])
      || parsed.v !== 1
      || !isNonEmptyString(parsed.purchaseDate)
      || !isNonEmptyString(parsed.id)
      || !isOptionalPurchaseStatus(parsed.status)
      || !isOptionalString(parsed.from)
      || !isOptionalString(parsed.to)
      || !isOptionalString(parsed.supplierCode)
      || !isOptionalString(parsed.documentNumber)
      || parsed.status !== (status ?? null)
      || parsed.from !== (from?.toISOString() ?? null)
      || parsed.to !== (to?.toISOString() ?? null)
      || parsed.supplierCode !== (supplierCode ?? null)
      || parsed.documentNumber !== (documentNumber ?? null)
    ) {
      throw new BadRequestException("Invalid purchase cursor.");
    }
    return { purchaseDate: this.parseCanonicalTimestamp(parsed.purchaseDate, "cursor"), id: parsed.id };
  }

  private decodeOpaqueCursor(value: string): Record<string, unknown> {
    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new BadRequestException("Invalid purchase cursor.");
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

type PurchaseCursorPayload = {
  v: 1;
  purchaseDate: string;
  id: string;
  status: PurchaseStatus | null;
  from: string | null;
  to: string | null;
  supplierCode: string | null;
  documentNumber: string | null;
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

function isOptionalPurchaseStatus(value: unknown): value is PurchaseStatus | null {
  return value === null || PURCHASE_STATUSES.includes(value as PurchaseStatus);
}
