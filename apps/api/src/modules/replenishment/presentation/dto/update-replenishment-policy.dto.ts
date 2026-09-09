import { Type } from "class-transformer";
import { IsInt, IsString, Matches, Min, ValidateIf } from "class-validator";

export class UpdateReplenishmentPolicyDto {
  @IsString()
  @Matches(/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/)
  reorderPointQuantity!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/)
  targetStockQuantity!: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
