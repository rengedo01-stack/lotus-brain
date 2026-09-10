import { Body, ConflictException, Controller, Delete, Get, Header, NotFoundException, Param, Put } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { MasterConflictError, MasterNotFoundError } from "../application/master.errors";
import { ProductSupplyPreferenceUseCases } from "../application/product-supply-preference.use-cases";
import { ClearProductSupplierPackagePreferenceDto, ClearProductSupplyPreferenceDto, SetProductSupplierPackagePreferenceDto, SetProductSupplyPreferenceDto } from "./dto/product-supply-preference.dto";
import { productSupplierPackagePreferenceContextSchema, productSupplyPreferenceContextSchema } from "./product-supply-preference-response.schemas";

const setSupplierSchema = { type: "object" as const, additionalProperties: false, required: ["relationshipId", "expectedVersion"], properties: { relationshipId: { type: "string" as const, minLength: 1 }, expectedVersion: { anyOf: [{ type: "integer" as const, minimum: 1 }, { type: "null" as const }] } } };
const setPackageSchema = { type: "object" as const, additionalProperties: false, required: ["packageId", "expectedVersion"], properties: { packageId: { type: "string" as const, minLength: 1 }, expectedVersion: { anyOf: [{ type: "integer" as const, minimum: 1 }, { type: "null" as const }] } } };
const clearSchema = { type: "object" as const, additionalProperties: false, required: ["expectedVersion"], properties: { expectedVersion: { type: "integer" as const, minimum: 1 } } };

@ApiTags("supply-preferences") @ApiCookieAuth()
@Controller()
export class ProductSupplyPreferenceController {
  constructor(private readonly useCases: ProductSupplyPreferenceUseCases) {}
  @Get("products/:productId/supply-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a Product's optional preferred supply relationship" }) @ApiOkResponse({ schema: productSupplyPreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.read is required." }) @ApiNotFoundResponse({ description: "Product not found." })
  getSupplier(@Param("productId") productId: string) { return this.run(() => this.useCases.getProduct(productId)); }
  @Put("products/:productId/supply-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Set or replace a Product's optional preferred supply relationship" }) @ApiBody({ schema: setSupplierSchema }) @ApiOkResponse({ schema: productSupplyPreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.write is required." }) @ApiConflictResponse({ description: "Stale preference or ineligible relationship." })
  setSupplier(@Param("productId") productId: string, @Body() dto: SetProductSupplyPreferenceDto) { return this.run(() => this.useCases.setProduct(productId, dto)); }
  @Delete("products/:productId/supply-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Clear a Product's optional preferred supply relationship" }) @ApiBody({ schema: clearSchema }) @ApiOkResponse({ schema: productSupplyPreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.write is required." }) @ApiNotFoundResponse({ description: "Product not found." }) @ApiConflictResponse({ description: "Stale or absent preference." })
  clearSupplier(@Param("productId") productId: string, @Body() dto: ClearProductSupplyPreferenceDto) { return this.run(() => this.useCases.clearProduct(productId, dto.expectedVersion)); }
  @Get("product-supply-relationships/:relationshipId/package-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a relationship's optional preferred order package" }) @ApiOkResponse({ schema: productSupplierPackagePreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.read is required." }) @ApiNotFoundResponse({ description: "ProductSupplyRelationship not found." })
  getPackage(@Param("relationshipId") relationshipId: string) { return this.run(() => this.useCases.getPackage(relationshipId)); }
  @Put("product-supply-relationships/:relationshipId/package-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Set or replace a relationship's optional preferred order package" }) @ApiBody({ schema: setPackageSchema }) @ApiOkResponse({ schema: productSupplierPackagePreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.write is required." }) @ApiNotFoundResponse({ description: "ProductSupplyRelationship or package not found." }) @ApiConflictResponse({ description: "Stale preference or ineligible package." })
  setPackage(@Param("relationshipId") relationshipId: string, @Body() dto: SetProductSupplierPackagePreferenceDto) { return this.run(() => this.useCases.setPackage(relationshipId, dto)); }
  @Delete("product-supply-relationships/:relationshipId/package-preference") @Header("Cache-Control", "private, no-store") @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Clear a relationship's optional preferred order package" }) @ApiBody({ schema: clearSchema }) @ApiOkResponse({ schema: productSupplierPackagePreferenceContextSchema }) @ApiUnauthorizedResponse({ description: "Authenticated session required." }) @ApiForbiddenResponse({ description: "master.write is required." }) @ApiNotFoundResponse({ description: "ProductSupplyRelationship not found." }) @ApiConflictResponse({ description: "Stale or absent preference." })
  clearPackage(@Param("relationshipId") relationshipId: string, @Body() dto: ClearProductSupplierPackagePreferenceDto) { return this.run(() => this.useCases.clearPackage(relationshipId, dto.expectedVersion)); }
  private async run<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message); if (error instanceof MasterConflictError) throw new ConflictException(error.message); throw error; } }
}
