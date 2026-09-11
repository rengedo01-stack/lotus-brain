import { Body, ConflictException, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { DismissReplenishmentRecommendationUseCase, GetActiveReplenishmentRecommendationUseCase, RecalculateReplenishmentRecommendationUseCase } from "../application/replenishment-recommendation.use-cases";
import { ReplenishmentRecommendationConflictError, ReplenishmentRecommendationNotFoundError } from "../application/replenishment-recommendation.errors";
import { DismissReplenishmentRecommendationDto } from "./dto/dismiss-replenishment-recommendation.dto";
import { recalculatedReplenishmentRecommendationResponseSchema, replenishmentRecommendationResponseSchema } from "./replenishment-recommendation-response.schemas";

const dismissRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["expectedVersion"],
  properties: { expectedVersion: { type: "integer" as const, minimum: 1 } },
};

@ApiTags("replenishment-recommendations")
@ApiCookieAuth()
@Controller("inventory")
export class ReplenishmentRecommendationController {
  constructor(
    private readonly getActiveUseCase: GetActiveReplenishmentRecommendationUseCase,
    private readonly recalculateUseCase: RecalculateReplenishmentRecommendationUseCase,
    private readonly dismissUseCase: DismissReplenishmentRecommendationUseCase,
  ) {}

  @Get(":productId/replenishment-recommendation")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ, Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get one Product's current immutable replenishment recommendation, if present" })
  @ApiOkResponse({ description: "The current active recommendation, if any, was returned with derived freshness.", schema: replenishmentRecommendationResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, and master.read are all required." })
  getActive(@Param("productId") productId: string) { return this.getActiveUseCase.execute(productId); }

  @Post(":productId/replenishment-recommendation")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ, Permissions.MASTER_READ, Permissions.REPLENISHMENT_MANAGE)
  @ApiOperation({ summary: "Create a new READY replenishment recommendation and supersede the current active artifact" })
  @ApiOkResponse({ description: "A new immutable recommendation snapshot was created from the current READY calculation.", schema: recalculatedReplenishmentRecommendationResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, master.read, and replenishment.manage are all required." })
  @ApiNotFoundResponse({ description: "The Product does not exist." })
  @ApiConflictResponse({ description: "The current preview is not READY or an authoritative input changed." })
  recalculate(@Req() request: AuthenticatedRequest, @Param("productId") productId: string) {
    return this.run(() => this.recalculateUseCase.execute(productId, this.actorUserId(request)));
  }

  @Post(":productId/replenishment-recommendation/:recommendationId/dismiss")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ, Permissions.MASTER_READ, Permissions.REPLENISHMENT_MANAGE)
  @ApiOperation({ summary: "Dismiss the current active replenishment recommendation without mutating its calculation snapshot" })
  @ApiBody({ schema: dismissRequestSchema })
  @ApiOkResponse({ description: "The immutable recommendation transitioned to DISMISSED.", schema: recalculatedReplenishmentRecommendationResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read, purchase.read, master.read, and replenishment.manage are all required." })
  @ApiNotFoundResponse({ description: "The Product or recommendation does not exist." })
  @ApiConflictResponse({ description: "The recommendation is no longer active or its lifecycle version is stale." })
  dismiss(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Param("recommendationId") recommendationId: string,
    @Body() dto: DismissReplenishmentRecommendationDto,
  ) {
    return this.run(() => this.dismissUseCase.execute(productId, recommendationId, dto.expectedVersion, this.actorUserId(request)));
  }

  private actorUserId(request: AuthenticatedRequest): string {
    const userId = request.authUser?.id;
    if (userId === undefined) throw new UnauthorizedException("Authentication required.");
    return userId;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error: unknown) {
      if (error instanceof ReplenishmentRecommendationNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ReplenishmentRecommendationConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
