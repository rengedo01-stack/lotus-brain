import { Type } from "class-transformer";
import { IsInt, IsString, Matches, Min, ValidateIf } from "class-validator";

const positiveDecimalPattern = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export class CreateProductSupplierOrderingTermsDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(positiveDecimalPattern)
  minimumOrderQuantity!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(positiveDecimalPattern)
  orderMultipleQuantity!: string | null;
}

export class UpdateProductSupplierOrderingTermsDto extends CreateProductSupplierOrderingTermsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
