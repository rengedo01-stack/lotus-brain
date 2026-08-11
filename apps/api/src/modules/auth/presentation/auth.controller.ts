import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Body,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { LoginUseCase, LogoutUseCase, RotateCsrfTokenUseCase, GetCurrentUserUseCase } from "../application/auth.use-cases";
import { AuthInvalidCredentialsError } from "../auth.errors";
import { Public } from "../decorators/public.decorator";
import { LoginDto } from "./dto/login.dto";
import type { EnvironmentVariables } from "../../../config/environment";
import { makeSessionCookieName } from "../auth.utils";
import type { AuthenticatedRequest, LoginResponse } from "../auth.types";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly loginUseCase: LoginUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly rotateCsrfTokenUseCase: RotateCsrfTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Log in with email and password" })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: "The login succeeded." })
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
      response.cookie(makeSessionCookieName(isProduction), result.sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      });
      response.setHeader("Cache-Control", "no-store");
      return { user: result.user, csrfToken: result.csrfToken };
    } catch (error: unknown) {
      if (error instanceof AuthInvalidCredentialsError) throw new UnauthorizedException(error.message);
      throw error;
    }
  }

  @Get("me")
  @ApiOperation({ summary: "Get the current authenticated user" })
  @ApiCookieAuth()
  async me(@Req() request: AuthenticatedRequest) {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return { user: await this.getCurrentUserUseCase.execute(request.authUser.id) };
  }

  @Get("csrf")
  @ApiOperation({ summary: "Rotate and return a CSRF token for the current session" })
  @ApiOkResponse({ description: "A CSRF token was issued." })
  @ApiCookieAuth()
  async csrf(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const session = request.authSession;
    if (session === undefined) throw new UnauthorizedException("Authentication required.");
    const csrfToken = await this.rotateCsrfTokenUseCase.execute(session.id);
    response.setHeader("Cache-Control", "no-store");
    return { csrfToken };
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Log out the current authenticated user" })
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
