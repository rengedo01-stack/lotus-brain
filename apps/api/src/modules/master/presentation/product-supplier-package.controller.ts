import { Body, ConflictException, Controller, Get, Header, NotFoundException, Param, Patch, Post, UnprocessableEntityException } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { MasterConflictError, MasterNotFoundError, MasterValidationError } from "../application/master.errors";
import {
  CreateProductSupplierPackageUseCase,
  GetProductSupplierPackageUseCase,
  ListProductSupplierPackagesUseCase,
  UpdateProductSupplierPackageUseCase,
} from "../application/product-supplier-package.use-cases";
import { CreateProductSupplierPackageDto, UpdateProductSupplierPackageDto } from "./dto/product-supplier-package.dto";
import { productSupplierPackageContextSchema, productSupplierPackagesContextSchema } from "./product-supplier-package-response.schemas";

const positiveQuantity = { type: "string" as const, pattern: "^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" };
const createRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["code", "name", "inventoryQuantityPerPackage", "isOrderable", "status"],
  properties: {
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    inventoryQuantityPerPackage: positiveQuantity,
    isOrderable: { type: "boolean" as const },
    status: { enum: ["ACTIVE", "DISABLED"] },
  },
};
const updateRequestSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [...createRequestSchema.required, "expectedVersion"],
  properties: { ...createRequestSchema.properties, expectedVersion: { type: "integer" as const, minimum: 1 } },
};

@ApiTags("product-supplier-packages")
@ApiCookieAuth()
@Controller("product-supply-relationships")
export class ProductSupplierPackageController {
  constructor(
    private readonly listUseCase: ListProductSupplierPackagesUseCase,
    private readonly getUseCase: GetProductSupplierPackageUseCase,
    private readonly createUseCase: CreateProductSupplierPackageUseCase,
    private readonly updateUseCase: UpdateProductSupplierPackageUseCase,
  ) {}

  @Get(":relationshipId/packages")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "List supplier-specific packages for a Product-Supplier relationship" })
  @ApiOkResponse({ description: "The relationship context and its current packages were returned.", schema: productSupplierPackagesContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  async list(@Param("relationshipId") relationshipId: string) {
    try {
      return await this.listUseCase.execute(relationshipId);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(":relationshipId/packages/:packageId")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_READ)
  @ApiOperation({ summary: "Get a supplier-specific package" })
  @ApiOkResponse({ description: "The relationship context and package were returned.", schema: productSupplierPackageContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.read is required." })
  @ApiNotFoundResponse({ description: "The package does not exist for this Product-Supplier relationship." })
  async get(@Param("relationshipId") relationshipId: string, @Param("packageId") packageId: string) {
    try {
      return await this.getUseCase.execute(relationshipId, packageId);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post(":relationshipId/packages")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Create a supplier-specific package" })
  @ApiBody({ schema: createRequestSchema })
  @ApiCreatedResponse({ description: "The package was created.", schema: productSupplierPackageContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The Product-Supplier relationship does not exist." })
  @ApiConflictResponse({ description: "A package with this code already exists or the relationship changed." })
  @ApiUnprocessableEntityResponse({ description: "Package code/name and Decimal(24,9) inventory quantity are invalid." })
  async create(@Param("relationshipId") relationshipId: string, @Body() dto: CreateProductSupplierPackageDto) {
    try {
      return await this.createUseCase.execute(relationshipId, dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError || this.isPrismaKnownError(error, "P2002")) throw new ConflictException(error instanceof Error ? error.message : "The package code already exists.");
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  @Patch(":relationshipId/packages/:packageId")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.MASTER_WRITE)
  @ApiOperation({ summary: "Update a supplier-specific package, including its ACTIVE/DISABLED lifecycle" })
  @ApiBody({ schema: updateRequestSchema })
  @ApiOkResponse({ description: "The package was updated.", schema: productSupplierPackageContextSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "master.write is required." })
  @ApiNotFoundResponse({ description: "The package or relationship does not exist." })
  @ApiConflictResponse({ description: "The expected package version is stale, the code is already in use, or the relationship changed." })
  @ApiUnprocessableEntityResponse({ description: "Package code/name and Decimal(24,9) inventory quantity are invalid." })
  async update(
    @Param("relationshipId") relationshipId: string,
    @Param("packageId") packageId: string,
    @Body() dto: UpdateProductSupplierPackageDto,
  ) {
    try {
      return await this.updateUseCase.execute(relationshipId, packageId, dto);
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError || this.isPrismaKnownError(error, "P2002")) throw new ConflictException(error instanceof Error ? error.message : "The package code already exists.");
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown, code: string): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
  }
}
