import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { Response } from "express";
import type { EnvironmentVariables } from "../../../config/environment";
import { AuthenticatedOnly } from "../../authorization/decorators/authenticated-only.decorator";
import { AuthInvalidCredentialsError } from "../auth.errors";
import type { AuthenticatedRequest } from "../auth.types";
import { CSRF_HEADER_NAME, LOGIN_THROTTLE_LIMIT, LOGIN_THROTTLE_TTL_MS } from "../auth.constants";
import { makeMfaPreauthCookieName, makeSessionCookieName } from "../auth.utils";
import { PasskeyCeremonyInvalidError } from "../application/passkey-enrollment.errors";
import {
  PasskeyMfaCeremonyInvalidError,
  PasskeyMfaConflictError,
  PasskeyMfaPrerequisiteError,
  PasskeyMfaService,
} from "../application/passkey-mfa.service";
import { Public } from "../decorators/public.decorator";
import { BeginPasskeyMfaDto, VerifyPasskeyMfaDto } from "./dto/passkey-mfa.dto";
import { authenticatedLoginResponseSchema } from "./auth-response.schemas";

@ApiTags("auth")
@ApiCookieAuth()
@Controller("auth/mfa/passkey")
@AuthenticatedOnly()
export class PasskeyMfaController {
  constructor(
    private readonly passkeyMfa: PasskeyMfaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's passkey MFA status" })
  async status(@Req() request: AuthenticatedRequest) {
    return this.passkeyMfa.getStatus(this.userId(request));
  }

  @Post("enable/options")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: BeginPasskeyMfaDto })
  @ApiOperation({ summary: "Start passkey MFA enablement after password re-authentication" })
  async beginEnable(@Req() request: AuthenticatedRequest, @Body() dto: BeginPasskeyMfaDto) {
    return this.run(() => this.passkeyMfa.beginEnable({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      currentPassword: dto.currentPassword,
    }));
  }

  @Post("enable/verify")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyPasskeyMfaDto })
  @ApiOperation({ summary: "Verify the passkey assertion and enable MFA" })
  async verifyEnable(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyPasskeyMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.run(() => this.passkeyMfa.verifyEnable({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      response: dto.response,
    }));
    this.clearSessionCookie(response);
    return { status: "ok" as const };
  }

  @Post("disable/options")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: BeginPasskeyMfaDto })
  @ApiOperation({ summary: "Start passkey MFA disablement after password re-authentication" })
  async beginDisable(@Req() request: AuthenticatedRequest, @Body() dto: BeginPasskeyMfaDto) {
    return this.run(() => this.passkeyMfa.beginDisable({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      currentPassword: dto.currentPassword,
    }));
  }

  @Post("disable/verify")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyPasskeyMfaDto })
  @ApiOperation({ summary: "Verify the passkey assertion and disable MFA" })
  async verifyDisable(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyPasskeyMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.run(() => this.passkeyMfa.verifyDisable({
      userId: this.userId(request),
      identitySessionId: this.sessionId(request),
      response: dto.response,
    }));
    this.clearSessionCookie(response);
    return { status: "ok" as const };
  }

  private userId(request: AuthenticatedRequest): string {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authUser.id;
  }

  private sessionId(request: AuthenticatedRequest): string {
    if (request.authSession === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authSession.id;
  }

  private clearSessionCookie(response: Response): void {
    const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
    response.clearCookie(makeSessionCookieName(isProduction), {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
    });
    response.setHeader("Cache-Control", "no-store");
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof AuthInvalidCredentialsError) throw new UnauthorizedException("Invalid credentials.");
      if (error instanceof PasskeyMfaCeremonyInvalidError || error instanceof PasskeyCeremonyInvalidError) {
        throw new BadRequestException("Passkey MFA ceremony is invalid or expired.");
      }
      if (error instanceof PasskeyMfaConflictError) throw new ConflictException(error.message);
      if (error instanceof PasskeyMfaPrerequisiteError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}

@ApiTags("auth")
@Controller("auth")
export class PasskeyMfaLoginController {
  constructor(
    private readonly passkeyMfa: PasskeyMfaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: LOGIN_THROTTLE_LIMIT, ttl: LOGIN_THROTTLE_TTL_MS } })
  @Post("login/passkey/verify")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VerifyPasskeyMfaDto })
  @ApiOperation({ summary: "Complete password-plus-passkey MFA login" })
  @ApiCookieAuth()
  @ApiHeader({ name: CSRF_HEADER_NAME, required: true, description: "The CSRF proof returned by the matching MFA_REQUIRED login response." })
  @ApiHeader({ name: "origin", required: false, description: "Optional browser origin. Required by the runtime only when the configured origin policy requires it." })
  @ApiHeader({ name: "referer", required: false, description: "Optional browser referrer used when Origin is absent." })
  @ApiOkResponse({ description: "A pending session was created after MFA verification.", schema: authenticatedLoginResponseSchema })
  @ApiUnauthorizedResponse({ description: "The MFA pre-authentication cookie, CSRF proof, assertion, user status, or login origin is invalid." })
  async verifyLogin(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyPasskeyMfaDto,
    @Headers(CSRF_HEADER_NAME) csrfHeader: string | string[] | undefined,
    @Headers("origin") origin: string | undefined,
    @Headers("referer") referer: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertLoginOrigin(origin, referer);
    const preAuthCsrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
    const preAuthToken = request.cookies?.[makeMfaPreauthCookieName(isProduction)];
    if (
      typeof preAuthToken !== "string" || preAuthToken.length === 0 ||
      typeof preAuthCsrfToken !== "string" || preAuthCsrfToken.length === 0
    ) {
      throw new UnauthorizedException("MFA login is invalid or expired.");
    }
    try {
      const result = await this.passkeyMfa.verifyMfaLogin({
        assertionResponse: dto.response,
        preAuthToken,
        preAuthCsrfToken,
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
      response.cookie(makeSessionCookieName(isProduction), result.sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      });
      response.clearCookie(makeMfaPreauthCookieName(isProduction), {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      });
      response.setHeader("Cache-Control", "no-store");
      return { user: result.user, csrfToken: result.csrfToken };
    } catch (error: unknown) {
      if (error instanceof PasskeyMfaCeremonyInvalidError || error instanceof PasskeyCeremonyInvalidError) {
        throw new UnauthorizedException("MFA login is invalid or expired.");
      }
      throw error;
    }
  }

  private assertLoginOrigin(origin?: string, referer?: string): void {
    const nodeEnvironment = this.configService.get("NODE_ENV", { infer: true });
    const allowedOrigins = this.configService
      .get("CORS_ORIGIN", { infer: true })
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const candidate = origin ?? this.extractOrigin(referer);
    if (candidate === undefined && nodeEnvironment !== "production") return;
    if (candidate === undefined || !allowedOrigins.includes(candidate)) {
      throw new UnauthorizedException("Invalid login origin.");
    }
  }

  private extractOrigin(referer?: string): string | undefined {
    if (typeof referer !== "string" || referer.length === 0) return undefined;
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
}
