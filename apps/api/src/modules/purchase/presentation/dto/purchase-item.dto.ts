import { IsNotEmpty, IsString, Matches } from "class-validator";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class PurchaseItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @Matches(DECIMAL)
  quantity!: string;

  @IsString()
  @IsNotEmpty()
  unitId!: string;

  @IsString()
  @Matches(DECIMAL)
  unitPrice!: string;

  @IsString()
  @Matches(DECIMAL)
  taxRate = "0";
}
