import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString, MaxLength, MinLength } from "class-validator";

export class BeginPasskeyRegistrationDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class VerifyPasskeyRegistrationDto {
  @ApiProperty({ description: "The JSON registration response returned by the browser WebAuthn API." })
  @IsObject()
  response!: object;
}

export class RenamePasskeyDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  displayName!: string;
}

export class RevokePasskeyDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}
