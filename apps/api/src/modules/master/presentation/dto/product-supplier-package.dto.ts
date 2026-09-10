import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Matches, Min } from "class-validator";

const positiveDecimalPattern = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export class CreateProductSupplierPackageDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(positiveDecimalPattern)
  inventoryQuantityPerPackage!: string;

  @IsBoolean()
  isOrderable!: boolean;

  @IsIn(["ACTIVE", "DISABLED"])
  status!: "ACTIVE" | "DISABLED";
}

export class UpdateProductSupplierPackageDto extends CreateProductSupplierPackageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
