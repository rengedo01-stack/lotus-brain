import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { AUTH_CSRF_EXEMPT_KEY, AUTH_PUBLIC_KEY, CSRF_HEADER_NAME } from "../auth.constants";
import type { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
    if (isPublic === true || isCsrfExempt === true || this.isDocsPath(request.url)) return true;

    const session = request.authSession;
    if (session === undefined) throw new UnauthorizedException("Authentication required.");

    const csrfToken = this.readCsrfToken(request);
    if (csrfToken === null) throw new ForbiddenException("CSRF token is required.");

    const tokenHash = createHash("sha256").update(csrfToken).digest("hex");
    if (tokenHash !== session.csrfTokenHash) {
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

  private isDocsPath(pathname: string): boolean {
    return pathname.includes("/docs") || pathname.includes("/docs-json");
  }
}
