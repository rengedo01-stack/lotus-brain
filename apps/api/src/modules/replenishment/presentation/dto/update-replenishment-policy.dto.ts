import { Type } from "class-transformer";
import { IsInt, IsString, Matches, Min } from "class-validator";

export class UpdateReplenishmentPolicyDto {
  @IsString()
  @Matches(/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/)
  reorderPointQuantity!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
