import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, ValidateIf, Min } from "class-validator";

export class SetProductSupplyPreferenceDto {
  @IsString() @IsNotEmpty() relationshipId!: string;
  @ValidateIf((value) => value.expectedVersion !== null) @Type(() => Number) @IsInt() @Min(1)
  expectedVersion!: number | null;
}
export class ClearProductSupplyPreferenceDto { @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number; }
export class SetProductSupplierPackagePreferenceDto {
  @IsString() @IsNotEmpty() packageId!: string;
  @ValidateIf((value) => value.expectedVersion !== null) @Type(() => Number) @IsInt() @Min(1)
  expectedVersion!: number | null;
}
export class ClearProductSupplierPackagePreferenceDto { @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number; }
