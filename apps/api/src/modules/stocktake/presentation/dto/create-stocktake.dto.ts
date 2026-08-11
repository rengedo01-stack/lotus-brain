import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { StocktakeItemDto } from "./stocktake-item.dto";

export class CreateStocktakeDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StocktakeItemDto)
  items!: StocktakeItemDto[];
}
