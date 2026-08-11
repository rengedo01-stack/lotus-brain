import { IsEnum, IsOptional, IsString } from "class-validator";
import { MasterStatus } from "../../../../generated/prisma/client";

export class CreateProductDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  baseUnitId!: string;

  @IsString()
  inventoryUnitId!: string;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}
