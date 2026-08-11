import { IsOptional, IsString, Matches } from "class-validator";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class StocktakeItemDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  countedQuantity?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
