import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { InventoryTransactionType } from "../../../../generated/prisma/client";

export const INVENTORY_TRANSACTION_TYPES = [
  "RECEIPT",
  "CONSUMPTION",
  "PRODUCTION_RECEIPT",
  "STOCKTAKE_ADJUSTMENT",
  "MANUAL_ADJUSTMENT",
] as const satisfies readonly InventoryTransactionType[];

export class ListInventoryHistoryQueryDto {
  @IsOptional()
  @IsIn(INVENTORY_TRANSACTION_TYPES)
  type?: InventoryTransactionType;

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
