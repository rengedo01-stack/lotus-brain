import { Type } from "class-transformer";
import { IsArray, IsDateString, IsOptional, IsString, ValidateNested } from "class-validator";
import { PurchaseItemDto } from "./purchase-item.dto";

export class UpdatePurchaseDto {
  @IsString()
  supplierId!: string;

  @IsDateString()
  purchaseDate!: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}
