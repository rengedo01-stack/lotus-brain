import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString, MaxLength, MinLength } from "class-validator";

export class BeginPasskeyMfaDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class VerifyPasskeyMfaDto {
  @ApiProperty({ description: "The JSON assertion returned by the browser WebAuthn API." })
  @IsObject()
  response!: object;
}
