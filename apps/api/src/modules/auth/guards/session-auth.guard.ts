import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { hashSecret } from "../auth.utils";
import { AUTH_PUBLIC_KEY, SESSION_COOKIE_NAME, SESSION_COOKIE_NAME_INSECURE } from "../auth.constants";
import { isAuthInfrastructurePath } from "../auth.routes";
import { AUTH_REPOSITORY, type AuthRepository } from "../application/auth.repository";
import type { EnvironmentVariables } from "../../../config/environment";
import type { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(AUTH_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (isAuthInfrastructurePath(request.url)) return true;

    const token = this.readSessionToken(request);
    if (token === null) throw new UnauthorizedException("Authentication required.");

    const tokenHash = hashSecret(token);
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

    request.authUser = {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      status: session.user.status,
      lastLoginAt: session.user.lastLoginAt,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    };
    request.authSession = session;
    await this.repository.touchSession(session.id, new Date()).catch(() => undefined);
    return true;
  }

  private readSessionToken(request: AuthenticatedRequest): string | null {
    const isProduction = this.configService.get("NODE_ENV", { infer: true }) === "production";
    const cookieName = isProduction ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;
    const cookieToken = request.cookies?.[cookieName];
    if (typeof cookieToken === "string" && cookieToken.length > 0) return cookieToken;
    return null;
  }
}
