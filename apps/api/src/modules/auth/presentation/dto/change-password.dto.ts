import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty({ format: "password" })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ format: "password", minLength: 15, maxLength: 128 })
  @IsString()
  newPassword!: string;
}
