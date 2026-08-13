import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class PasswordRecoveryRequestDto {
  @ApiProperty({ description: "The email address associated with the account." })
  @IsString()
  @MaxLength(320)
  email!: string;
}

export class PasswordRecoveryResetDto {
  @ApiProperty({ format: "password", description: "The recovery credential delivered through the verified email channel." })
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  token!: string;

  @ApiProperty({ format: "password", minLength: 15, maxLength: 128 })
  @IsString()
  @MaxLength(128)
  newPassword!: string;
}
