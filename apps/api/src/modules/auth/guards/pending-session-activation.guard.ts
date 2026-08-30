import {
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { EnvironmentVariables } from "../../../config/environment";
import { AUTH_REPOSITORY, type AuthRepository } from "../application/auth.repository";
import {
  AUTH_PENDING_SESSION_ACTIVATION_KEY,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME_INSECURE,
} from "../auth.constants";
import { hashSecret } from "../auth.utils";
import type { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class PendingSessionActivationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isActivation = this.reflector.getAllAndOverride<boolean>(AUTH_PENDING_SESSION_ACTIVATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isActivation !== true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.method.toUpperCase() !== "POST") {
      throw new UnauthorizedException("Authentication required.");
    }
    if (
      request.body !== undefined &&
      (typeof request.body !== "object" || request.body === null || Array.isArray(request.body) || Object.keys(request.body).length > 0)
    ) {
      throw new BadRequestException("Session activation does not accept a request body.");
    }
    this.assertOrigin(request.headers.origin, request.headers.referer);

    const token = this.readSessionToken(request);
    if (token === null) throw new UnauthorizedException("Authentication required.");
    const csrfToken = this.readCsrfToken(request);
    if (csrfToken === null) throw new ForbiddenException("CSRF token is required.");

    const tokenHash = hashSecret(token);
    const csrfTokenHash = hashSecret(csrfToken);
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.user === null ||
      session.user.status !== "ACTIVE" ||
      session.user.deletedAt !== null ||
      session.credentialVersion !== session.user.credentialVersion ||
      session.authenticationPolicyVersion !== session.user.authenticationPolicyVersion
    ) {
      throw new UnauthorizedException("Authentication required.");
    }
    if (session.csrfTokenHash !== csrfTokenHash) throw new ForbiddenException("CSRF token is invalid.");

    // The controller receives only hashes; identity remains bound to the
    // HttpOnly cookie and no session or user identifier is accepted in a body.
    request.pendingSessionActivation = {
      id: session.id,
      userId: session.userId,
      credentialVersion: session.credentialVersion,
      authenticationPolicyVersion: session.authenticationPolicyVersion,
      tokenHash,
      csrfTokenHash,
    };
    return true;
  }

  private readSessionToken(request: AuthenticatedRequest): string | null {
    const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
    const cookieName = isProduction ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;
    const token = request.cookies?.[cookieName];
    return typeof token === "string" && token.length > 0 ? token : null;
  }

  private readCsrfToken(request: AuthenticatedRequest): string | null {
    const header = request.headers[CSRF_HEADER_NAME];
    if (Array.isArray(header)) return header[0] ?? null;
    return typeof header === "string" && header.length > 0 ? header : null;
  }

  private assertOrigin(origin?: string, referer?: string): void {
    const nodeEnvironment = this.configService.get("NODE_ENV", { infer: true });
    const allowedOrigins = this.configService
      .get("CORS_ORIGIN", { infer: true })
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const candidate = origin ?? this.extractOrigin(referer);
    if (candidate === undefined && nodeEnvironment !== "production") return;
    if (candidate === undefined || !allowedOrigins.includes(candidate)) {
      throw new UnauthorizedException("Invalid activation origin.");
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
