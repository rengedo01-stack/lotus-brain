import { Type } from "class-transformer";
import { IsIn, IsInt, IsString, Matches, Min } from "class-validator";

const unitPricePattern = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const taxRatePattern = /^(?:0(?:\.[0-9]{1,4})?|1(?:\.0{1,4})?)$/;

export class CreateProductSupplierCommercialTermsDto {
  @IsString()
  @Matches(unitPricePattern)
  unitPrice!: string;

  @IsString()
  @IsIn(["JPY"])
  currencyCode!: "JPY";

  @IsString()
  @Matches(taxRatePattern)
  taxRate!: string;
}

export class UpdateProductSupplierCommercialTermsDto extends CreateProductSupplierCommercialTermsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ClearProductSupplierCommercialTermsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
