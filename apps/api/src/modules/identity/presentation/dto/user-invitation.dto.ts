import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { UserInvitationStatus } from "../../../../generated/prisma/client";

export class CreateUserInvitationDto {
  @ApiProperty({ description: "The mailbox to invite. Roles are never accepted from the client." })
  @IsString()
  @MaxLength(320)
  @IsEmail()
  email!: string;
}

export class ListUserInvitationsQueryDto {
  @ApiPropertyOptional({ enum: UserInvitationStatus })
  @IsOptional()
  @IsEnum(UserInvitationStatus)
  status?: UserInvitationStatus;

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

export class AcceptUserInvitationDto {
  @ApiProperty({ format: "password", description: "The credential delivered by the invitation email." })
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  token!: string;

  @ApiProperty({ format: "password", minLength: 15, maxLength: 128 })
  @IsString()
  @MaxLength(128)
  password!: string;
}
