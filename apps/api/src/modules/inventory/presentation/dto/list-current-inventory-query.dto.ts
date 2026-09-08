import { Transform, Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListCurrentInventoryQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  productCode?: string;

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
