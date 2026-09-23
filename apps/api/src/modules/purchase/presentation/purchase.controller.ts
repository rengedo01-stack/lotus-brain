import {
  ConflictException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
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
  CancelPurchaseUseCase,
  CreatePurchaseDraftUseCase,
  GetPurchaseUseCase,
  UpdatePurchaseDraftMetadataUseCase,
  UpdatePurchaseDraftUseCase,
} from "../application/purchase-draft.use-cases";
import { ListPurchasesUseCase } from "../application/list-purchases.use-case";
import type { PurchaseListCursor } from "../application/purchase-list.repository";
import {
  PurchaseDraftConflictError,
  PurchaseDraftForbiddenError,
  PurchaseDraftNotFoundError,
  PurchaseDraftValidationError,
} from "../application/purchase-draft.errors";
import { CreatePurchaseDto } from "./dto/create-purchase.dto";
import { UpdatePurchaseDto } from "./dto/update-purchase.dto";
import { UpdatePurchaseMetadataDto } from "./dto/update-purchase-metadata.dto";
import { CancelPurchaseDto } from "./dto/cancel-purchase.dto";
import { CreatePurchaseReversalDto } from "./dto/create-purchase-reversal.dto";
import { CreateRecommendationPurchaseDraftDto } from "./dto/create-recommendation-purchase-draft.dto";
import { cancelledPurchaseResponseSchema, postedPurchaseResponseSchema, purchaseDraftResponseSchema, purchaseHandoffLineageResponseSchema, purchaseListPageResponseSchema, purchaseReversalAuditResponseSchema, recommendationPurchaseDraftHandoffResponseSchema, recommendationPurchaseHandoffLineageResponseSchema } from "./purchase-response.schemas";
import { ListPurchasesQueryDto, PURCHASE_STATUSES } from "./dto/list-purchases-query.dto";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { CreateRecommendationPurchaseDraftUseCase } from "../application/recommendation-purchase-handoff.use-case";
import { GetRecommendationPurchaseHandoffUseCase } from "../application/get-recommendation-purchase-handoff.use-case";
import { GetPurchaseHandoffLineageUseCase } from "../application/get-purchase-handoff-lineage.use-case";
import { PurchaseRecommendationHandoffLineageNotFoundError, RecommendationPurchaseHandoffConflictError, RecommendationPurchaseHandoffNotFoundError } from "../application/recommendation-purchase-handoff.errors";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import { AuthenticatedOnly } from "../../authorization/decorators/authenticated-only.decorator";
import { PurchasePostedReversalService } from "../application/purchase-posted-reversal.service";
import {
  PurchasePostedReversalConflictError,
  PurchasePostedReversalNotFoundError,
  PurchasePostedReversalValidationError,
} from "../application/purchase-posted-reversal.errors";

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
    private readonly updatePurchaseDraftMetadataUseCase: UpdatePurchaseDraftMetadataUseCase,
    private readonly createRecommendationPurchaseDraftUseCase: CreateRecommendationPurchaseDraftUseCase,
    private readonly getRecommendationPurchaseHandoffUseCase: GetRecommendationPurchaseHandoffUseCase,
    private readonly getPurchaseHandoffLineageUseCase: GetPurchaseHandoffLineageUseCase,
    private readonly cancelPurchaseUseCase: CancelPurchaseUseCase,
    private readonly purchasePostedReversalService: PurchasePostedReversalService,
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
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_WRITE)
  @ApiOperation({ summary: "Create a purchase draft" })
  @ApiCreatedResponse({ description: "The new DRAFT purchase was created.", schema: purchaseDraftResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.write is required." })
  @ApiUnprocessableEntityResponse({ description: "The submitted purchase draft is invalid." })
  createPurchase(@Body() dto: CreatePurchaseDto) {
    return this.runDraft(() => this.createPurchaseDraftUseCase.execute(dto));
  }

  @Post("replenishment-recommendations/:recommendationId/draft")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(
    Permissions.INVENTORY_READ,
    Permissions.PURCHASE_READ,
    Permissions.MASTER_READ,
    Permissions.REPLENISHMENT_MANAGE,
    Permissions.PURCHASE_WRITE,
  )
  @ApiOperation({ summary: "Create or replay a Purchase draft from a current replenishment recommendation" })
  @ApiCreatedResponse({ description: "The handoff created one immutable-provenance Purchase draft.", schema: recommendationPurchaseDraftHandoffResponseSchema })
  @ApiOkResponse({ description: "The Recommendation was already handed off; the original Purchase draft was returned.", schema: recommendationPurchaseDraftHandoffResponseSchema })
  @ApiBadRequestResponse({ description: "purchaseDate must be a canonical UTC timestamp." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, master.read, replenishment.manage, and purchase.write are all required." })
  @ApiNotFoundResponse({ description: "The Recommendation does not exist." })
  @ApiConflictResponse({ description: "The Recommendation is not ACTIVE and CURRENT, its inventory unit changed, or current commercial terms are unavailable." })
  async createRecommendationPurchaseDraft(
    @Param("recommendationId") recommendationId: string,
    @Body() dto: CreateRecommendationPurchaseDraftDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.createRecommendationPurchaseDraftUseCase.execute(
        recommendationId,
        this.parseCanonicalTimestamp(dto.purchaseDate, "purchaseDate"),
      );
      response.status(result.replayed ? 200 : 201);
      return { purchase: result.purchase };
    } catch (error: unknown) {
      if (error instanceof RecommendationPurchaseHandoffNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof RecommendationPurchaseHandoffConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get("replenishment-recommendations/:recommendationId/handoff")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ, Permissions.MASTER_READ)
  @ApiOperation({ summary: "Read immutable Purchase handoff lineage for one replenishment recommendation" })
  @ApiOkResponse({ description: "The handoff lineage was returned, or null when the Recommendation has not been handed off.", schema: recommendationPurchaseHandoffLineageResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, and master.read are all required." })
  @ApiNotFoundResponse({ description: "The Recommendation does not exist." })
  async getRecommendationPurchaseHandoff(@Param("recommendationId") recommendationId: string) {
    try {
      return { handoff: await this.getRecommendationPurchaseHandoffUseCase.execute(recommendationId) };
    } catch (error: unknown) {
      if (error instanceof RecommendationPurchaseHandoffNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(":id/handoff-lineage")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ, Permissions.MASTER_READ)
  @ApiOperation({ summary: "Read immutable replenishment handoff lineage for one Purchase" })
  @ApiOkResponse({ description: "Immutable handoff lineage was returned in PurchaseItem line order; an ordinary Purchase returns an empty list.", schema: purchaseHandoffLineageResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, and master.read are all required." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  async getPurchaseHandoffLineage(@Param("id") purchaseId: string) {
    try {
      return { handoffs: await this.getPurchaseHandoffLineageUseCase.execute(purchaseId) };
    } catch (error: unknown) {
      if (error instanceof PurchaseRecommendationHandoffLineageNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(":id/reversal")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_READ, Permissions.INVENTORY_READ, Permissions.MASTER_READ)
  @ApiOperation({ summary: "Read the immutable audit snapshot for one posted-purchase correction" })
  @ApiOkResponse({ description: "The immutable correction audit record was returned, or null when this Purchase has not been corrected.", schema: purchaseReversalAuditResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.read, inventory.read, and master.read are all required." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  async getPurchaseReversalAudit(@Param("id") purchaseId: string) {
    try {
      return { reversal: await this.purchasePostedReversalService.readAudit(purchaseId) };
    } catch (error: unknown) {
      if (error instanceof PurchasePostedReversalNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(":id/reversal-preview")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_REVERSE_POSTED)
  @ApiOperation({ summary: "Preview an audited correction of a POSTED purchase" })
  @ApiOkResponse({ description: "The correction preview includes refusal reasons, current inventory effects, PriceMaster versions, and required explicit price resolutions." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.reversePosted is required." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  async getPurchaseReversalPreview(@Param("id") purchaseId: string) {
    try {
      return await this.purchasePostedReversalService.preview(purchaseId);
    } catch (error: unknown) {
      if (error instanceof PurchasePostedReversalNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post(":id/reversals")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_REVERSE_POSTED)
  @ApiOperation({ summary: "Apply one auditable current-time correction for a POSTED purchase" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reason", "previewVersion", "idempotencyKey", "priceResolutions"],
      properties: {
        reason: { type: "string", minLength: 1, maxLength: 10_000 },
        previewVersion: { type: "string", pattern: "^[a-f0-9]{64}$" },
        idempotencyKey: { type: "string", format: "uuid" },
        priceResolutions: { type: "array" },
      },
    },
  })
  @ApiCreatedResponse({ description: "The correction was recorded, or an idempotent retry returned the existing correction." })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.reversePosted is required." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  @ApiConflictResponse({ description: "The preview is stale, the Purchase was already corrected, an inventory safety condition failed, or another operation conflicted." })
  @ApiUnprocessableEntityResponse({ description: "The correction request is invalid." })
  async createPurchaseReversal(
    @Req() request: AuthenticatedRequest,
    @Param("id") purchaseId: string,
    @Body() dto: CreatePurchaseReversalDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actorUserId = request.authUser?.id;
    if (actorUserId === undefined) throw new UnauthorizedException("Authentication required.");
    try {
      const result = await this.purchasePostedReversalService.execute({
        purchaseId,
        actorUserId,
        reason: dto.reason,
        previewVersion: dto.previewVersion,
        idempotencyKey: dto.idempotencyKey,
        priceResolutions: dto.priceResolutions,
      });
      response.status(result.replayed ? 200 : 201);
      return result;
    } catch (error: unknown) {
      if (error instanceof PurchasePostedReversalNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PurchasePostedReversalConflictError) throw new ConflictException(error.message);
      if (error instanceof PurchasePostedReversalValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_READ)
  @ApiOperation({ summary: "Get a purchase" })
  @ApiOkResponse({ description: "The purchase was returned.", schema: purchaseDraftResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.read is required." })
  @ApiNotFoundResponse({ description: "The purchase does not exist." })
  getPurchase(@Param("id") id: string) {
    return this.runDraft(() => this.getPurchaseUseCase.execute(id));
  }

  @Patch(":id")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_WRITE)
  @ApiOperation({ summary: "Update a purchase draft" })
  @ApiOkResponse({ description: "The DRAFT purchase was updated.", schema: purchaseDraftResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.write is required." })
  @ApiNotFoundResponse({ description: "The purchase does not exist." })
  @ApiConflictResponse({ description: "The purchase is no longer editable." })
  @ApiUnprocessableEntityResponse({ description: "The submitted purchase draft is invalid." })
  updatePurchase(@Param("id") id: string, @Body() dto: UpdatePurchaseDto) {
    return this.runDraft(() => this.updatePurchaseDraftUseCase.execute(id, dto));
  }

  @Patch(":id/metadata")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_WRITE)
  @ApiOperation({ summary: "Update editable Purchase draft metadata" })
  @ApiOkResponse({ description: "The DRAFT Purchase metadata was updated.", schema: purchaseDraftResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.write is required." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  @ApiConflictResponse({ description: "The Purchase is no longer a DRAFT." })
  updatePurchaseMetadata(@Param("id") id: string, @Body() dto: UpdatePurchaseMetadataDto) {
    if (dto.documentNumber === undefined && dto.note === undefined) throw new BadRequestException("At least one editable metadata field is required.");
    return this.runDraft(() => this.updatePurchaseDraftMetadataUseCase.execute(id, dto));
  }

  @Post(":id/confirm")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.PURCHASE_CONFIRM)
  @ApiOperation({ summary: "Confirm a purchase draft" })
  @ApiCreatedResponse({ description: "The DRAFT purchase transitioned to CONFIRMED.", schema: purchaseDraftResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.confirm is required." })
  @ApiNotFoundResponse({ description: "The purchase does not exist." })
  @ApiConflictResponse({ description: "The purchase cannot be confirmed." })
  @ApiUnprocessableEntityResponse({ description: "A purchase with no items cannot be confirmed." })
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

  @Post(":id/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  // The required permission is selected from the Purchase status while its
  // lifecycle row is locked: DRAFT requires purchase.write, CONFIRMED requires
  // purchase.confirm. The repository performs that authoritative check in the
  // same transaction; this decorator preserves normal session/CSRF protection.
  @AuthenticatedOnly()
  @ApiOperation({ summary: "Cancel a DRAFT or CONFIRMED purchase with a required reason" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reason"],
      properties: { reason: { type: "string", minLength: 1, maxLength: 10_000 } },
    },
  })
  @ApiOkResponse({ description: "The Purchase transitioned to CANCELLED and its reason was persisted.", schema: cancelledPurchaseResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "purchase.write is required for DRAFT cancellation; purchase.confirm is required for CONFIRMED cancellation." })
  @ApiNotFoundResponse({ description: "The Purchase does not exist." })
  @ApiConflictResponse({ description: "Only DRAFT and CONFIRMED Purchases can be cancelled." })
  @ApiUnprocessableEntityResponse({ description: "A non-empty cancellation reason is required." })
  cancelPurchase(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() dto: CancelPurchaseDto) {
    const actorUserId = request.authUser?.id;
    if (actorUserId === undefined) throw new UnauthorizedException("Authentication required.");
    return this.runDraft(() => this.cancelPurchaseUseCase.execute(id, dto.reason, actorUserId));
  }

  private async runDraft<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof PurchaseDraftNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PurchaseDraftForbiddenError) throw new ForbiddenException(error.message);
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
