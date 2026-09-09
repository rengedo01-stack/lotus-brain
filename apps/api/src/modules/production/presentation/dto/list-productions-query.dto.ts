import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { ProductionStatus } from "../../../../generated/prisma/client";

export const PRODUCTION_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const satisfies readonly ProductionStatus[];

const trimString = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ListProductionsQueryDto {
  @IsOptional()
  @IsIn(PRODUCTION_STATUSES)
  status?: ProductionStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trimString)
  recipeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trimString)
  outputProductIdSnapshot?: string;

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
  cursor?: string;
}
