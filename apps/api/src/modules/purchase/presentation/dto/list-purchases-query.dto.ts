import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { PurchaseStatus } from "../../../../generated/prisma/client";

export const PURCHASE_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const satisfies readonly PurchaseStatus[];

const trimString = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ListPurchasesQueryDto {
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;

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
  supplierCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trimString)
  documentNumber?: string;

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
