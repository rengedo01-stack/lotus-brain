import { Body, ConflictException, Controller, Get, Header, NotFoundException, Param, Patch, Post, Query, UnprocessableEntityException } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { MasterConflictError, MasterNotFoundError, MasterValidationError } from "../application/master.errors";
import {
  CreateProductSupplierOrderingTermsUseCase,
  GetProductSupplierOrderingTermsUseCase,
  ListProductSupplierOrderingTermsUseCase,
  UpdateProductSupplierOrderingTermsUseCase,
} from "../application/product-supplier-ordering-terms.use-cases";
import { ListQueryDto } from "./dto/list-query.dto";
import { CreateProductSupplierOrderingTermsDto, UpdateProductSupplierOrderingTermsDto } from "./dto/product-supplier-ordering-terms.dto";
import { productSupplierOrderingTermsContextSchema, productSupplierOrderingTermsListSchema } from "./product-supplier-ordering-terms-response.schemas";

const positiveQuantity = { type: "string" as const, pattern: "^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" };
const createRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["minimumOrderQuantity", "orderMultipleQuantity"],
  properties: {
    minimumOrderQuantity: { oneOf: [positiveQuantity, { type: "null" as const }] },
    orderMultipleQuantity: { oneOf: [positiveQuantity, { type: "null" as const }] },
  },
};
const updateRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["minimumOrderQuantity", "orderMultipleQuantity", "expectedVersion"],
  properties: { ...createRequestSchema.properties, expectedVersion: { type: "integer" as const, minimum: 1 } },
};

@ApiTags("product-supplier-ordering-terms")
@ApiCookieAuth()
@Controller("product-supply-relationships")
export class ProductSupplierOrderingTermsController {
  constructor(
    private readonly getUseCase: GetProductSupplierOrderingTermsUseCase,
    private readonly listUseCase: ListProductSupplierOrderingTermsUseCase,
    private readonly createUseCase: CreateProductSupplierOrderingTermsUseCase,
    private readonly updateUseCase: UpdateProductSupplierOrderingTermsUseCase,
  ) {}

  @Get("ordering-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "List configured supplier-specific ordering terms" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "offset", required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ description: "Configured current ordering terms were returned.", schema: productSupplierOrderingTermsListSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  list(@Query() query: ListQueryDto) {
    return this.listUseCase.execute(query);
  }

  @Get(":relationshipId/ordering-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get current ordering terms for a Product-Supplier relationship" })
  @ApiOkResponse({ description: "The relationship and its current ordering terms, if configured, were returned.", schema: productSupplierOrderingTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  async get(@Param("relationshipId") relationshipId: string) {
    try {
      return await this.getUseCase.execute(relationshipId);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post(":relationshipId/ordering-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Create current supplier-specific ordering terms" })
  @ApiBody({ schema: createRequestSchema })
  @ApiCreatedResponse({ description: "The current ordering terms were created.", schema: productSupplierOrderingTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  @ApiConflictResponse({ description: "Ordering terms already exist or the relationship changed." })
  @ApiUnprocessableEntityResponse({ description: "MOQ and order multiple must be positive Decimal(24,9) strings or null." })
  async create(@Param("relationshipId") relationshipId: string, @Body() dto: CreateProductSupplierOrderingTermsDto) {
    try {
      return await this.createUseCase.execute(relationshipId, dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  @Patch(":relationshipId/ordering-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Update current supplier-specific ordering terms with optimistic concurrency control" })
  @ApiBody({ schema: updateRequestSchema })
  @ApiOkResponse({ description: "The current ordering terms were updated.", schema: productSupplierOrderingTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The relationship or its ordering terms do not exist." })
  @ApiConflictResponse({ description: "The expected terms version is stale or the relationship changed." })
  @ApiUnprocessableEntityResponse({ description: "MOQ and order multiple must be positive Decimal(24,9) strings or null." })
  async update(@Param("relationshipId") relationshipId: string, @Body() dto: UpdateProductSupplierOrderingTermsDto) {
    try {
      return await this.updateUseCase.execute(relationshipId, dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
