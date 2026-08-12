import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin@lotus-brain.local" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "change-me-now", format: "password" })
  @IsString()
  @MinLength(8)
  password!: string;
}
