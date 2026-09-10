import { Type } from "class-transformer";
import { IsEnum, IsInt, IsString, Min } from "class-validator";
import { ProductSupplyRelationshipStatus } from "../../../../generated/prisma/client";

export class CreateProductSupplyRelationshipDto {
  @IsString()
  productId!: string;

  @IsString()
  supplierId!: string;
}

export class UpdateProductSupplyRelationshipDto {
  @IsEnum(ProductSupplyRelationshipStatus)
  status!: ProductSupplyRelationshipStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
