import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { RecipeStatus } from "../../../../generated/prisma/client";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class RecipeItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  unitId!: string;

  @IsString()
  @Matches(DECIMAL)
  quantity!: string;
}

export class RecipeDraftDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  outputProductId!: string;

  @IsString()
  @Matches(DECIMAL)
  yieldQuantity!: string;

  @IsString()
  @IsNotEmpty()
  yieldUnitId!: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecipeItemDto)
  items!: RecipeItemDto[];
}

export class CreateRecipeDto extends RecipeDraftDto {}

export class UpdateRecipeDto extends RecipeDraftDto {}

export class ListRecipeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @IsOptional()
  @IsEnum(RecipeStatus)
  status?: RecipeStatus;
}
