import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class EmailVerificationRequestDto {}

export class EmailVerificationConfirmDto {
  @ApiProperty({ format: "password", description: "The verification credential delivered through the email channel." })
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  token!: string;
}
