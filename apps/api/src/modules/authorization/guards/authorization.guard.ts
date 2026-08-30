import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_PENDING_SESSION_ACTIVATION_KEY, AUTH_PUBLIC_KEY } from "../../auth/auth.constants";
import { isAuthInfrastructurePath } from "../../auth/auth.routes";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import {
  AUTHENTICATED_ONLY_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from "../authorization.constants";
import { AuthorizationService } from "../application/authorization.service";
import type { PermissionCode } from "../permission.registry";

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (isAuthInfrastructurePath(request.url)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(AUTH_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const isPendingActivation = this.reflector.getAllAndOverride<boolean>(AUTH_PENDING_SESSION_ACTIVATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPendingActivation === true) return true;

    if (request.authUser === undefined) {
      throw new UnauthorizedException("Authentication required.");
    }

    const isAuthenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAuthenticatedOnly === true) return true;

    const requiredPermissions = this.reflector.getAllAndOverride<readonly PermissionCode[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredPermissions === undefined || requiredPermissions.length === 0) {
      throw new ForbiddenException("Permission denied.");
    }

    try {
      const permitted = await this.authorizationService.hasAllPermissions(
        request.authUser.id,
        requiredPermissions,
      );
      if (!permitted) throw new ForbiddenException("Permission denied.");
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("Authorization service is unavailable.");
    }

    return true;
  }
}
