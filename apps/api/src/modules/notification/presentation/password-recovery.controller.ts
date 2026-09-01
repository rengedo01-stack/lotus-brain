import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AuthValidationError } from "../../auth/auth.errors";
import { Public } from "../../auth/decorators/public.decorator";
import { PasswordRecoveryTokenInvalidError } from "../application/recovery-channel.errors";
import { PasswordRecoveryService } from "../application/password-recovery.service";
import { notificationRequestAcceptedResponseSchema } from "../notification-response.schemas";
import { PasswordRecoveryRequestDto, PasswordRecoveryResetDto } from "./dto/password-recovery.dto";

@ApiTags("auth")
@Controller("auth/password/recovery")
export class PasswordRecoveryController {
  constructor(private readonly passwordRecoveryService: PasswordRecoveryService) {}

  @Post("request")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: PasswordRecoveryRequestDto })
  @ApiOperation({ summary: "Request a password recovery email; the response is always generic." })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: "The password recovery request was accepted.",
    schema: notificationRequestAcceptedResponseSchema,
  })
  async request(@Body() dto: PasswordRecoveryRequestDto) {
    await this.passwordRecoveryService.request(dto.email);
    return { status: "accepted" as const };
  }

  @Post("reset")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PasswordRecoveryResetDto })
  @ApiOperation({ summary: "Reset a password with a valid recovery credential." })
  async reset(@Body() dto: PasswordRecoveryResetDto) {
    try {
      await this.passwordRecoveryService.reset(dto.token, dto.newPassword);
      return { status: "ok" as const };
    } catch (error: unknown) {
      if (error instanceof PasswordRecoveryTokenInvalidError) {
        throw new BadRequestException("Recovery credential is invalid or expired.");
      }
      if (error instanceof AuthValidationError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
