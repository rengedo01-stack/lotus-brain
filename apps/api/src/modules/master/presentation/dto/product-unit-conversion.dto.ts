import { IsEnum, IsOptional, IsString } from "class-validator";
import { MasterStatus } from "../../../../generated/prisma/client";

export class CreateProductUnitConversionDto {
  @IsString()
  unitId!: string;

  @IsString()
  factorToBaseUnit!: string;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}
