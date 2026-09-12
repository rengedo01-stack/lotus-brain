import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class DismissReplenishmentRecommendationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
