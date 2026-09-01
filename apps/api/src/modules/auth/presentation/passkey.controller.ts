import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthenticatedOnly } from "../../authorization/decorators/authenticated-only.decorator";
import { AuthInvalidCredentialsError } from "../auth.errors";
import type { AuthenticatedRequest } from "../auth.types";
import {
  PasskeyCeremonyInvalidError,
  PasskeyConflictError,
  PasskeyNotFoundError,
  PasskeyValidationError,
} from "../application/passkey-enrollment.errors";
import { PasskeyEnrollmentService } from "../application/passkey-enrollment.service";
import {
  BeginPasskeyRegistrationDto,
  RenamePasskeyDto,
  RevokePasskeyDto,
  VerifyPasskeyRegistrationDto,
} from "./dto/passkey.dto";
import { passkeyListResponseSchema, passkeyMutationResponseSchema } from "./passkey-response.schemas";

@ApiTags("auth")
@ApiCookieAuth()
@Controller("auth/passkeys")
@AuthenticatedOnly()
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyEnrollmentService) {}

  @Post("registration/options")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: BeginPasskeyRegistrationDto })
  @ApiOperation({ summary: "Start passkey registration after current-password re-authentication" })
  async beginRegistration(@Req() request: AuthenticatedRequest, @Body() dto: BeginPasskeyRegistrationDto) {
    return this.run(() => this.passkeys.beginRegistration({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      currentPassword: dto.currentPassword,
    }));
  }

  @Post("registration/verify")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyPasskeyRegistrationDto })
  @ApiOkResponse({ description: "The passkey was registered.", schema: passkeyMutationResponseSchema })
  @ApiOperation({ summary: "Verify and persist a passkey registration response" })
  async verifyRegistration(@Req() request: AuthenticatedRequest, @Body() dto: VerifyPasskeyRegistrationDto) {
    const passkey = await this.run(() => this.passkeys.verifyRegistration({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      registrationResponse: dto.response,
    }));
    return { passkey };
  }

  @Get()
  @ApiOperation({ summary: "List the current user's passkeys without credential material" })
  @ApiOkResponse({ description: "The current user's passkeys were returned without credential material.", schema: passkeyListResponseSchema })
  list(@Req() request: AuthenticatedRequest) {
    return this.passkeys.listPasskeys(this.userId(request));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename one of the current user's passkeys" })
  @ApiOkResponse({ description: "The passkey was renamed.", schema: passkeyMutationResponseSchema })
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param("id") passkeyId: string,
    @Body() dto: RenamePasskeyDto,
  ) {
    const passkey = await this.run(() => this.passkeys.renamePasskey({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      passkeyId,
      displayName: dto.displayName,
    }));
    return { passkey };
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RevokePasskeyDto })
  @ApiOperation({ summary: "Revoke one of the current user's passkeys after password re-authentication" })
  @ApiOkResponse({ description: "The passkey was revoked.", schema: passkeyMutationResponseSchema })
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param("id") passkeyId: string,
    @Body() dto: RevokePasskeyDto,
  ) {
    const passkey = await this.run(() => this.passkeys.revokePasskey({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      passkeyId,
      currentPassword: dto.currentPassword,
    }));
    return { passkey };
  }

  private userId(request: AuthenticatedRequest): string {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authUser.id;
  }

  private sessionId(request: AuthenticatedRequest): string {
    if (request.authSession === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authSession.id;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof AuthInvalidCredentialsError) throw new UnauthorizedException("Invalid credentials.");
      if (error instanceof PasskeyCeremonyInvalidError) {
        throw new BadRequestException("Passkey registration is invalid or expired.");
      }
      if (error instanceof PasskeyConflictError) throw new ConflictException(error.message);
      if (error instanceof PasskeyNotFoundError) throw new NotFoundException("Passkey was not found.");
      if (error instanceof PasskeyValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
