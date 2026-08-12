import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { UserStatus } from "../../../../generated/prisma/client";

export class ListIdentityUsersQueryDto {
  @ApiPropertyOptional({ example: "operator@lotus-brain.local" })
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: "Filter soft-deleted users when specified." })
  @IsOptional()
  @Transform(({ value }) => value === "true" ? true : value === "false" ? false : value)
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class UpdateIdentityUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;
}
