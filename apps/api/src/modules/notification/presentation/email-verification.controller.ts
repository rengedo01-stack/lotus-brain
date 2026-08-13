import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import { Public } from "../../auth/decorators/public.decorator";
import { AuthenticatedOnly } from "../../authorization/decorators/authenticated-only.decorator";
import { EmailVerificationTokenInvalidError } from "../application/recovery-channel.errors";
import { EmailVerificationService } from "../application/email-verification.service";
import { EmailVerificationConfirmDto, EmailVerificationRequestDto } from "./dto/email-verification.dto";

@ApiTags("auth")
@Controller("auth/email/verification")
export class EmailVerificationController {
  constructor(private readonly emailVerificationService: EmailVerificationService) {}

  @Post("request")
  @AuthenticatedOnly()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Request verification for the current authenticated user's email address" })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: "A request was accepted; an already verified email is a no-op." })
  async request(
    @Req() request: AuthenticatedRequest,
    @Body() dto: EmailVerificationRequestDto,
  ) {
    void dto;
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    await this.emailVerificationService.request(request.authUser.id);
    return { status: "accepted" as const };
  }

  @Post("confirm")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: EmailVerificationConfirmDto })
  @ApiOperation({ summary: "Confirm an email verification credential" })
  async confirm(@Body() dto: EmailVerificationConfirmDto) {
    try {
      await this.emailVerificationService.confirm(dto.token);
      return { status: "verified" as const };
    } catch (error: unknown) {
      if (error instanceof EmailVerificationTokenInvalidError) {
        throw new BadRequestException("Verification token is invalid or expired.");
      }
      throw error;
    }
  }
}
