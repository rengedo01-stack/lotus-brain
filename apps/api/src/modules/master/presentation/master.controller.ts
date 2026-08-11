import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { MasterConflictError, MasterNotFoundError, MasterValidationError } from "../application/master.errors";
import {
  CreateProductUseCase,
  CreateSupplierUseCase,
  CreateUnitUseCase,
  GetProductUseCase,
  GetSupplierUseCase,
  GetUnitUseCase,
  ListProductsUseCase,
  ListSuppliersUseCase,
  ListUnitsUseCase,
  UpdateProductUseCase,
  UpdateSupplierUseCase,
  UpdateUnitUseCase,
} from "../application/master.use-cases";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { CreateSupplierDto, UpdateSupplierDto } from "./dto/supplier.dto";
import { ListQueryDto } from "./dto/list-query.dto";
import { CreateUnitDto, UpdateUnitDto } from "./dto/unit.dto";

@ApiTags("masters")
@Controller()
export class MasterController {
  constructor(
    private readonly createProductUseCase: CreateProductUseCase,
    private readonly getProductUseCase: GetProductUseCase,
    private readonly listProductsUseCase: ListProductsUseCase,
    private readonly updateProductUseCase: UpdateProductUseCase,
    private readonly createUnitUseCase: CreateUnitUseCase,
    private readonly getUnitUseCase: GetUnitUseCase,
    private readonly listUnitsUseCase: ListUnitsUseCase,
    private readonly updateUnitUseCase: UpdateUnitUseCase,
    private readonly createSupplierUseCase: CreateSupplierUseCase,
    private readonly getSupplierUseCase: GetSupplierUseCase,
    private readonly listSuppliersUseCase: ListSuppliersUseCase,
    private readonly updateSupplierUseCase: UpdateSupplierUseCase,
  ) {}

  @Post("products")
  @ApiOperation({ summary: "Create a product" })
  createProduct(@Body() dto: CreateProductDto) {
    return this.run(() => this.createProductUseCase.execute(dto));
  }

  @Get("products")
  @ApiOperation({ summary: "List products" })
  listProducts(@Query() query: ListQueryDto) {
    return this.run(() => this.listProductsUseCase.execute(query));
  }

  @Get("products/:id")
  @ApiOperation({ summary: "Get a product" })
  getProduct(@Param("id") id: string) {
    return this.run(() => this.getProductUseCase.execute(id));
  }

  @Patch("products/:id")
  @ApiOperation({ summary: "Update a product" })
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.run(() => this.updateProductUseCase.execute(id, dto));
  }

  @Post("units")
  @ApiOperation({ summary: "Create a unit" })
  createUnit(@Body() dto: CreateUnitDto) {
    return this.run(() => this.createUnitUseCase.execute(dto));
  }

  @Get("units")
  @ApiOperation({ summary: "List units" })
  listUnits(@Query() query: ListQueryDto) {
    return this.run(() => this.listUnitsUseCase.execute(query));
  }

  @Get("units/:id")
  @ApiOperation({ summary: "Get a unit" })
  getUnit(@Param("id") id: string) {
    return this.run(() => this.getUnitUseCase.execute(id));
  }

  @Patch("units/:id")
  @ApiOperation({ summary: "Update a unit" })
  updateUnit(@Param("id") id: string, @Body() dto: UpdateUnitDto) {
    return this.run(() => this.updateUnitUseCase.execute(id, dto));
  }

  @Post("suppliers")
  @ApiOperation({ summary: "Create a supplier" })
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.run(() => this.createSupplierUseCase.execute(dto));
  }

  @Get("suppliers")
  @ApiOperation({ summary: "List suppliers" })
  listSuppliers(@Query() query: ListQueryDto) {
    return this.run(() => this.listSuppliersUseCase.execute(query));
  }

  @Get("suppliers/:id")
  @ApiOperation({ summary: "Get a supplier" })
  getSupplier(@Param("id") id: string) {
    return this.run(() => this.getSupplierUseCase.execute(id));
  }

  @Patch("suppliers/:id")
  @ApiOperation({ summary: "Update a supplier" })
  updateSupplier(@Param("id") id: string, @Body() dto: UpdateSupplierDto) {
    return this.run(() => this.updateSupplierUseCase.execute(id, dto));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof MasterNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MasterConflictError) throw new ConflictException(error.message);
      if (error instanceof MasterValidationError) throw new UnprocessableEntityException(error.message);
      if (this.isPrismaKnownError(error)) {
        if (error.code === "P2002") throw new ConflictException("A unique constraint was violated.");
        if (error.code === "P2003") throw new UnprocessableEntityException("A foreign key constraint was violated.");
        if (error.code === "P2025") throw new NotFoundException("The requested record was not found.");
      }
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string";
  }
}
