import {
  CanActivate,
  ExecutionContext,
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
  AUTH_CSRF_EXEMPT_KEY,
  AUTH_PENDING_SESSION_ACTIVATION_KEY,
  AUTH_PUBLIC_KEY,
  CSRF_HEADER_NAME,
} from "../auth.constants";
import { isAuthInfrastructurePath } from "../auth.routes";
import { hashSecret } from "../auth.utils";
import type { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.isSafeMethod(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(AUTH_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isCsrfExempt = this.reflector.getAllAndOverride<boolean>(AUTH_CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPendingActivation = this.reflector.getAllAndOverride<boolean>(AUTH_PENDING_SESSION_ACTIVATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true || isCsrfExempt === true || isPendingActivation === true || isAuthInfrastructurePath(request.url)) return true;

    const session = request.authSession;
    if (session === undefined) throw new UnauthorizedException("Authentication required.");

    const csrfToken = this.readCsrfToken(request);
    if (csrfToken === null) throw new ForbiddenException("CSRF token is required.");

    const tokenIsValid = await this.repository.isSessionCsrfTokenValid({
      sessionId: session.id,
      csrfTokenHash: hashSecret(csrfToken),
      allowLegacyScalarFallback: this.configService.get("CSRF_LEGACY_SCALAR_FALLBACK", { infer: true }),
    });
    if (!tokenIsValid) {
      throw new ForbiddenException("CSRF token is invalid.");
    }
    return true;
  }

  private readCsrfToken(request: AuthenticatedRequest): string | null {
    const header = request.headers[CSRF_HEADER_NAME];
    if (Array.isArray(header)) return header[0] ?? null;
    if (typeof header === "string" && header.length > 0) return header;
    return null;
  }

  private isSafeMethod(method: string): boolean {
    return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  }
}
