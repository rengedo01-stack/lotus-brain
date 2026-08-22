import { IsDateString, IsOptional, IsString, Matches } from "class-validator";

const DECIMAL_24_9 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/;

export class UpdateProductionDto {
  @IsOptional()
  @IsDateString()
  productionDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_24_9)
  plannedQuantity?: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
