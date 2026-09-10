import { Body, ConflictException, Controller, Get, Header, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { MasterConflictError, MasterNotFoundError } from "../application/master.errors";
import {
  CreateProductSupplyRelationshipUseCase,
  GetProductSupplyRelationshipUseCase,
  ListProductSupplyRelationshipsUseCase,
  UpdateProductSupplyRelationshipUseCase,
} from "../application/master.use-cases";
import { ListQueryDto } from "./dto/list-query.dto";
import { CreateProductSupplyRelationshipDto, UpdateProductSupplyRelationshipDto } from "./dto/product-supply-relationship.dto";
import { productSupplyRelationshipListSchema, productSupplyRelationshipSchema } from "./product-supply-relationship-response.schemas";

const createRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["productId", "supplierId"],
  properties: {
    productId: { type: "string" as const, minLength: 1 },
    supplierId: { type: "string" as const, minLength: 1 },
  },
};

const updateRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status", "expectedVersion"],
  properties: {
    status: { enum: ["ACTIVE", "DISABLED"] },
    expectedVersion: { type: "integer" as const, minimum: 1 },
  },
};

@ApiTags("product-supply-relationships")
@ApiCookieAuth()
@Controller("product-supply-relationships")
export class ProductSupplyRelationshipController {
  constructor(
    private readonly createUseCase: CreateProductSupplyRelationshipUseCase,
    private readonly getUseCase: GetProductSupplyRelationshipUseCase,
    private readonly listUseCase: ListProductSupplyRelationshipsUseCase,
    private readonly updateUseCase: UpdateProductSupplyRelationshipUseCase,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "List Product-Supplier supply relationships" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "offset", required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ description: "The managed Product-Supplier supply relationships were returned.", schema: productSupplyRelationshipListSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  list(@Query() query: ListQueryDto) {
    return this.listUseCase.execute(query);
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a Product-Supplier supply relationship" })
  @ApiOkResponse({ description: "The managed Product-Supplier supply relationship was returned.", schema: productSupplyRelationshipSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The relationship does not exist." })
  async get(@Param("id") id: string) {
    try {
      return await this.getUseCase.execute(id);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Create an active Product-Supplier supply relationship" })
  @ApiBody({ schema: createRequestSchema })
  @ApiCreatedResponse({ description: "The active relationship was created.", schema: productSupplyRelationshipSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product or Supplier does not exist." })
  @ApiConflictResponse({ description: "The relationship already exists or one of its parent masters is unavailable." })
  async create(@Body() dto: CreateProductSupplyRelationshipDto) {
    try {
      return await this.createUseCase.execute(dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      if (this.isPrismaKnownError(error) && error.code === "P2002") throw new ConflictException("The Product-Supplier relationship already exists.");
      throw error;
    }
  }

  @Patch(":id")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Change a Product-Supplier relationship status with optimistic concurrency control" })
  @ApiBody({ schema: updateRequestSchema })
  @ApiOkResponse({ description: "The relationship status was updated.", schema: productSupplyRelationshipSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The relationship does not exist." })
  @ApiConflictResponse({ description: "The expected version is stale or the relationship cannot be enabled while a parent master is unavailable." })
  async update(@Param("id") id: string, @Body() dto: UpdateProductSupplyRelationshipDto) {
    try {
      return await this.updateUseCase.execute(id, dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string";
  }
}
