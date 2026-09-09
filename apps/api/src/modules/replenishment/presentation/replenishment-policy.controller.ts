import { Body, ConflictException, Controller, Get, Header, NotFoundException, Param, Patch, Post, UnprocessableEntityException } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { CreateReplenishmentPolicyUseCase, GetReplenishmentPolicyUseCase, UpdateReplenishmentPolicyUseCase } from "../application/replenishment-policy.use-cases";
import { ReplenishmentPolicyConflictError, ReplenishmentPolicyNotFoundError, ReplenishmentPolicyValidationError } from "../application/replenishment-policy.errors";
import { CreateReplenishmentPolicyDto } from "./dto/create-replenishment-policy.dto";
import { UpdateReplenishmentPolicyDto } from "./dto/update-replenishment-policy.dto";
import { replenishmentPolicyContextSchema, replenishmentPolicySchema } from "./replenishment-policy-response.schemas";

const createPolicyRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["reorderPointQuantity", "targetStockQuantity"],
  properties: {
    reorderPointQuantity: { type: "string" as const, pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" },
    targetStockQuantity: { oneOf: [{ type: "string" as const, pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" }, { type: "null" as const }] },
  },
};

const updatePolicyRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["reorderPointQuantity", "targetStockQuantity", "expectedVersion"],
  properties: {
    ...createPolicyRequestSchema.properties,
    expectedVersion: { type: "integer" as const, minimum: 1 },
  },
};

@ApiTags("replenishment-policies")
@ApiCookieAuth()
@Controller("products")
export class ReplenishmentPolicyController {
  constructor(
    private readonly getReplenishmentPolicyUseCase: GetReplenishmentPolicyUseCase,
    private readonly createReplenishmentPolicyUseCase: CreateReplenishmentPolicyUseCase,
    private readonly updateReplenishmentPolicyUseCase: UpdateReplenishmentPolicyUseCase,
  ) {}

  @Get(":productId/replenishment-policy")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a Product's current replenishment policy context" })
  @ApiOkResponse({ description: "The Product and its current policy, if configured, were returned.", schema: replenishmentPolicyContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The Product does not exist." })
  async get(@Param("productId") productId: string) {
    try {
      return await this.getReplenishmentPolicyUseCase.execute(productId);
    } catch (error: unknown) {
      if (error instanceof ReplenishmentPolicyNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post(":productId/replenishment-policy")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Create a Product's current replenishment policy" })
  @ApiBody({ schema: createPolicyRequestSchema })
  @ApiCreatedResponse({ description: "The current replenishment policy was created.", schema: replenishmentPolicySchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product does not exist." })
  @ApiConflictResponse({ description: "The Product is unavailable or already has a policy." })
  async create(@Param("productId") productId: string, @Body() dto: CreateReplenishmentPolicyDto) {
    try {
      return await this.createReplenishmentPolicyUseCase.execute(productId, dto);
    } catch (error: unknown) {
      if (error instanceof ReplenishmentPolicyNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ReplenishmentPolicyConflictError) throw new ConflictException(error.message);
      if (error instanceof ReplenishmentPolicyValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  @Patch(":productId/replenishment-policy")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Update a Product's current replenishment policy with optimistic concurrency control" })
  @ApiBody({ schema: updatePolicyRequestSchema })
  @ApiOkResponse({ description: "The current replenishment policy was updated.", schema: replenishmentPolicySchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product or its current policy does not exist." })
  @ApiConflictResponse({ description: "The Product is unavailable or the expected policy version is stale." })
  async update(@Param("productId") productId: string, @Body() dto: UpdateReplenishmentPolicyDto) {
    try {
      return await this.updateReplenishmentPolicyUseCase.execute(productId, dto);
    } catch (error: unknown) {
      if (error instanceof ReplenishmentPolicyNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ReplenishmentPolicyConflictError) throw new ConflictException(error.message);
      if (error instanceof ReplenishmentPolicyValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
