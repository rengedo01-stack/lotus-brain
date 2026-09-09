import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { StocktakeStatus } from "../../../../generated/prisma/client";

export const STOCKTAKE_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const satisfies readonly StocktakeStatus[];

const trimString = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ListStocktakesQueryDto {
  @IsOptional()
  @IsIn(STOCKTAKE_STATUSES)
  status?: StocktakeStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  createdFrom?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  @Transform(trimString)
  cursor?: string;
}
