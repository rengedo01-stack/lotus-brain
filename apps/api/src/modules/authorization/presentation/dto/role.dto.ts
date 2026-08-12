import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
import { RoleStatus } from "../../../../generated/prisma/client";

const CUSTOM_ROLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export class CreateCustomRoleDto {
  @ApiProperty({ example: "KITCHEN_OPERATOR" })
  @IsString()
  @Matches(CUSTOM_ROLE_CODE)
  code!: string;

  @ApiProperty({ example: "Kitchen operator" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: "Posts production records." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateCustomRoleDto {
  @ApiPropertyOptional({ example: "Senior kitchen operator" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: "Posts production records.", nullable: true })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ enum: RoleStatus })
  @IsOptional()
  @IsEnum(RoleStatus)
  status?: RoleStatus;
}
