import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdatePurchaseMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string | null;
}
