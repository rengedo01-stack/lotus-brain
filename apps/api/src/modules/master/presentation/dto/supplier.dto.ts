import { IsEnum, IsOptional, IsString } from "class-validator";
import { MasterStatus } from "../../../../generated/prisma/client";

export class CreateSupplierDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}
