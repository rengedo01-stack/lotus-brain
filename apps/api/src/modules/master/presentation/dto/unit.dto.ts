import { IsEnum, IsOptional, IsString } from "class-validator";
import { MasterStatus, UnitDimension } from "../../../../generated/prisma/client";

export class CreateUnitDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  symbol!: string;

  @IsEnum(UnitDimension)
  dimension!: UnitDimension;

  @IsOptional()
  @IsEnum(MasterStatus)
  status?: MasterStatus;
}

export class UpdateUnitDto {
  @IsEnum(MasterStatus)
  status!: MasterStatus;
}
