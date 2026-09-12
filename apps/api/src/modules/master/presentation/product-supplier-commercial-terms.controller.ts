import { Body, ConflictException, Controller, Delete, Get, Header, NotFoundException, Param, Patch, Post, UnprocessableEntityException } from "@nestjs/common";
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { MasterConflictError, MasterNotFoundError, MasterValidationError } from "../application/master.errors";
import {
  ClearProductSupplierCommercialTermsUseCase,
  CreateProductSupplierCommercialTermsUseCase,
  GetProductSupplierCommercialTermsUseCase,
  UpdateProductSupplierCommercialTermsUseCase,
} from "../application/product-supplier-commercial-terms.use-cases";
import {
  ClearProductSupplierCommercialTermsDto,
  CreateProductSupplierCommercialTermsDto,
  UpdateProductSupplierCommercialTermsDto,
} from "./dto/product-supplier-commercial-terms.dto";
import { productSupplierCommercialTermsContextSchema } from "./product-supplier-commercial-terms-response.schemas";

const unitPriceSchema = { type: "string" as const, pattern: "^(?:0|[1-9][0-9]{0,13})(?:\\.[0-9]{1,6})?$" };
const taxRateSchema = { type: "string" as const, pattern: "^(?:0(?:\\.[0-9]{1,4})?|1(?:\\.0{1,4})?)$" };
const createRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["unitPrice", "currencyCode", "taxRate"],
  properties: { unitPrice: unitPriceSchema, currencyCode: { type: "string" as const, enum: ["JPY"] }, taxRate: taxRateSchema },
};
const updateRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["unitPrice", "currencyCode", "taxRate", "expectedVersion"],
  properties: { ...createRequestSchema.properties, expectedVersion: { type: "integer" as const, minimum: 1 } },
};
const clearRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["expectedVersion"],
  properties: { expectedVersion: { type: "integer" as const, minimum: 1 } },
};

@ApiTags("product-supplier-commercial-terms")
@ApiCookieAuth()
@Controller("product-supply-relationships")
export class ProductSupplierCommercialTermsController {
  constructor(
    private readonly getUseCase: GetProductSupplierCommercialTermsUseCase,
    private readonly createUseCase: CreateProductSupplierCommercialTermsUseCase,
    private readonly updateUseCase: UpdateProductSupplierCommercialTermsUseCase,
    private readonly clearUseCase: ClearProductSupplierCommercialTermsUseCase,
  ) {}

  @Get(":relationshipId/commercial-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get current supplier-specific tax-exclusive JPY commercial terms" })
  @ApiOkResponse({ description: "The relationship and its current commercial authority, if configured, were returned.", schema: productSupplierCommercialTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  async get(@Param("relationshipId") relationshipId: string) {
    return this.run(() => this.getUseCase.execute(relationshipId));
  }

  @Post(":relationshipId/commercial-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Set current supplier-specific tax-exclusive JPY commercial terms" })
  @ApiBody({ schema: createRequestSchema })
  @ApiCreatedResponse({ description: "Current commercial terms were created.", schema: productSupplierCommercialTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  @ApiConflictResponse({ description: "Commercial terms already exist or the relationship is not eligible." })
  @ApiBadRequestResponse({ description: "The request shape, JPY currencyCode, or Decimal input is invalid." })
  @ApiUnprocessableEntityResponse({ description: "unitPrice, JPY currencyCode, or taxRate is invalid." })
  async create(@Param("relationshipId") relationshipId: string, @Body() dto: CreateProductSupplierCommercialTermsDto) {
    return this.run(() => this.createUseCase.execute(relationshipId, dto));
  }

  @Patch(":relationshipId/commercial-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Replace current supplier-specific commercial terms with optimistic concurrency control" })
  @ApiBody({ schema: updateRequestSchema })
  @ApiOkResponse({ description: "Current commercial terms were updated.", schema: productSupplierCommercialTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The relationship or its commercial terms do not exist." })
  @ApiConflictResponse({ description: "The expected commercial-terms version is stale or the relationship is not eligible." })
  @ApiBadRequestResponse({ description: "The request shape, JPY currencyCode, Decimal input, or expectedVersion is invalid." })
  @ApiUnprocessableEntityResponse({ description: "unitPrice, JPY currencyCode, or taxRate is invalid." })
  async update(@Param("relationshipId") relationshipId: string, @Body() dto: UpdateProductSupplierCommercialTermsDto) {
    return this.run(() => this.updateUseCase.execute(relationshipId, dto));
  }

  @Delete(":relationshipId/commercial-terms")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Clear current supplier-specific commercial terms" })
  @ApiBody({ schema: clearRequestSchema })
  @ApiOkResponse({ description: "Current commercial terms were cleared.", schema: productSupplierCommercialTermsContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  @ApiConflictResponse({ description: "Commercial terms changed or are not configured." })
  @ApiBadRequestResponse({ description: "The request shape or expectedVersion is invalid." })
  async clear(@Param("relationshipId") relationshipId: string, @Body() dto: ClearProductSupplierCommercialTermsDto) {
    return this.run(() => this.clearUseCase.execute(relationshipId, dto.expectedVersion));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
