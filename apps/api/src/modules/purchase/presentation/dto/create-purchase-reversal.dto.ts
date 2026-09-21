import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class PurchaseReversalPriceResolutionDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedPriceMasterVersion!: number;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  currentUnitPrice!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class CreatePurchaseReversalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  reason!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewVersion!: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @IsArray()
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReversalPriceResolutionDto)
  priceResolutions!: PurchaseReversalPriceResolutionDto[];
}
