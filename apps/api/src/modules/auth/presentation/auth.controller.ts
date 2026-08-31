import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  Body,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  ChangePasswordUseCase,
  ActivateSessionUseCase,
  LoginUseCase,
  LogoutUseCase,
  RotateCsrfTokenUseCase,
  GetCurrentUserUseCase,
} from "../application/auth.use-cases";
import {
  AuthConflictError,
  AuthInvalidCredentialsError,
  AuthSessionActivationCsrfError,
  AuthSessionActivationUnauthorizedError,
  AuthValidationError,
} from "../auth.errors";
import { Public } from "../decorators/public.decorator";
import { PendingSessionActivation } from "../decorators/pending-session-activation.decorator";
import { AuthenticatedOnly } from "../../authorization/decorators/authenticated-only.decorator";
import { AuthorizationService } from "../../authorization/application/authorization.service";
import { ALL_PERMISSION_CODES } from "../../authorization/permission.registry";
import { LoginDto } from "./dto/login.dto";
import type { EnvironmentVariables } from "../../../config/environment";
import { makeMfaPreauthCookieName, makeSessionCookieName } from "../auth.utils";
import type { AuthenticatedRequest, LoginResponse } from "../auth.types";
import { ChangePasswordDto } from "./dto/change-password.dto";
import {
  authenticatedLoginUserResponseSchema,
  csrfTokenResponseSchema,
  loginResponseSchema,
  sessionActivationResponseSchema,
} from "./auth-response.schemas";

const currentUserResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["user"],
  properties: { user: authenticatedLoginUserResponseSchema },
};

const currentPermissionsResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["permissions"],
  properties: {
    permissions: {
      type: "array" as const,
      uniqueItems: true,
      items: {
        type: "string" as const,
        enum: [...ALL_PERMISSION_CODES],
      },
    },
  },
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly loginUseCase: LoginUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly authorizationService: AuthorizationService,
    private readonly rotateCsrfTokenUseCase: RotateCsrfTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly activateSessionUseCase: ActivateSessionUseCase,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Log in with email and password" })
  @ApiBody({ type: LoginDto })
  @ApiHeader({ name: "origin", required: false, description: "Optional browser origin. Required by the runtime only when the configured origin policy requires it." })
  @ApiHeader({ name: "referer", required: false, description: "Optional browser referrer used when Origin is absent." })
  @ApiOkResponse({ description: "The login either produced a pending session or requires passkey MFA.", schema: loginResponseSchema })
  @ApiUnauthorizedResponse({ description: "The credentials, user status, or login origin are invalid." })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("origin") origin?: string,
    @Headers("referer") referer?: string,
  ): Promise<LoginResponse> {
    this.assertLoginOrigin(origin, referer);
    try {
      const result = await this.loginUseCase.execute({
        email: dto.email,
        ipAddress: request.ip,
        password: dto.password,
        userAgent: request.headers["user-agent"] ?? null,
      });
      const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
      response.setHeader("Cache-Control", "no-store");
      if (result.status === "MFA_REQUIRED") {
        response.cookie(makeMfaPreauthCookieName(isProduction), result.preAuthToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: isProduction,
          path: "/",
        });
        return {
          status: "MFA_REQUIRED" as const,
          options: result.options,
          preAuthCsrfToken: result.preAuthCsrfToken,
        };
      }
      response.cookie(makeSessionCookieName(isProduction), result.sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      });
      return { user: result.user, csrfToken: result.csrfToken };
    } catch (error: unknown) {
      if (error instanceof AuthInvalidCredentialsError) throw new UnauthorizedException(error.message);
      throw error;
    }
  }

  @Post("session/activate")
  @PendingSessionActivation()
  @HttpCode(200)
  @ApiOperation({ summary: "Activate the pending session bound to this login response" })
  @ApiCookieAuth()
  @ApiHeader({ name: "x-csrf-token", required: true, description: "The CSRF proof returned by the same login response." })
  @ApiOkResponse({ description: "The pending session was activated.", schema: sessionActivationResponseSchema })
  async activateSession(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const activation = request.pendingSessionActivation;
    if (activation === undefined) throw new UnauthorizedException("Authentication required.");
    try {
      await this.activateSessionUseCase.execute({
        tokenHash: activation.tokenHash,
        csrfTokenHash: activation.csrfTokenHash,
      });
      response.setHeader("Cache-Control", "no-store");
      return { status: "ok" as const };
    } catch (error: unknown) {
      if (error instanceof AuthSessionActivationCsrfError) throw new ForbiddenException(error.message);
      if (error instanceof AuthSessionActivationUnauthorizedError) throw new UnauthorizedException(error.message);
      throw error;
    }
  }

  @Post("password/change")
  @AuthenticatedOnly()
  @HttpCode(200)
  @ApiOperation({ summary: "Change the current authenticated user's password" })
  @ApiCookieAuth()
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    try {
      await this.changePasswordUseCase.execute({
        userId: request.authUser.id,
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
      });
      response.clearCookie(makeSessionCookieName(this.configService.get("NODE_ENV", { infer: true }) === "production"), {
        httpOnly: true,
        sameSite: "lax",
        secure: this.configService.get("NODE_ENV", { infer: true }) === "production",
        path: "/",
      });
      response.setHeader("Cache-Control", "no-store");
      return { status: "ok" as const };
    } catch (error: unknown) {
      if (error instanceof AuthInvalidCredentialsError) throw new UnauthorizedException(error.message);
      if (error instanceof AuthConflictError) throw new ConflictException("Credential state conflict. Retry after signing in again.");
      if (error instanceof AuthValidationError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  @Get("me")
  @AuthenticatedOnly()
  @ApiOperation({ summary: "Get the current authenticated user" })
  @ApiCookieAuth()
  @ApiOkResponse({ description: "The current authenticated user was returned.", schema: currentUserResponseSchema })
  async me(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    response.setHeader("Cache-Control", "no-store");
    return { user: await this.getCurrentUserUseCase.execute(request.authUser.id) };
  }

  @Get("me/permissions")
  @AuthenticatedOnly()
  @ApiOperation({ summary: "Get the current authenticated user's effective permissions" })
  @ApiCookieAuth()
  @ApiOkResponse({ description: "The current authenticated user's effective permissions were returned.", schema: currentPermissionsResponseSchema })
  async permissions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    response.setHeader("Cache-Control", "no-store");
    return { permissions: await this.authorizationService.listEffectivePermissions(request.authUser.id) };
  }

  @Get("csrf")
  @AuthenticatedOnly()
  @ApiOperation({ summary: "Rotate and return a CSRF token for the current session" })
  @ApiOkResponse({ description: "A CSRF token was issued.", schema: csrfTokenResponseSchema })
  @ApiCookieAuth()
  async csrf(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const session = request.authSession;
    if (session === undefined) throw new UnauthorizedException("Authentication required.");
    const csrfToken = await this.rotateCsrfTokenUseCase.execute(session.id);
    response.setHeader("Cache-Control", "no-store");
    return { csrfToken };
  }

  @Post("logout")
  @AuthenticatedOnly()
  @HttpCode(200)
  @ApiOperation({ summary: "Log out the current authenticated user" })
  @ApiCookieAuth()
  @ApiHeader({ name: "x-csrf-token", required: true, description: "The CSRF token issued for the current activated session." })
  @ApiOkResponse({ description: "The current session was revoked and the session cookie was cleared.", schema: sessionActivationResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise no longer authenticated." })
  @ApiForbiddenResponse({ description: "The CSRF token is missing or invalid." })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const session = request.authSession;
    if (session === undefined) throw new UnauthorizedException("Authentication required.");
    await this.logoutUseCase.execute(session.id);
    response.clearCookie(makeSessionCookieName(this.configService.get("NODE_ENV", { infer: true }) === "production"), {
      httpOnly: true,
      sameSite: "lax",
      secure: this.configService.get("NODE_ENV", { infer: true }) === "production",
      path: "/",
    });
    response.setHeader("Cache-Control", "no-store");
    return { status: "ok" as const };
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
