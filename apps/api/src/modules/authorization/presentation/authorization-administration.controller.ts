import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import {
  AuthorizationAdministrationConflictError,
  AuthorizationAdministrationForbiddenError,
  AuthorizationAdministrationNotFoundError,
  AuthorizationAdministrationValidationError,
} from "../application/authorization-administration.errors";
import { AuthorizationAdministrationService } from "../application/authorization-administration.service";
import { RequirePermissions } from "../decorators/require-permissions.decorator";
import { Permissions } from "../permission.registry";
import { CreateCustomRoleDto, UpdateCustomRoleDto } from "./dto/role.dto";

@ApiTags("authorization")
@ApiCookieAuth()
@Controller("authorization")
export class AuthorizationAdministrationController {
  constructor(private readonly administrationService: AuthorizationAdministrationService) {}

  @Post("roles")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Create a custom role (requires authorization.manage)" })
  createRole(@Req() request: AuthenticatedRequest, @Body() dto: CreateCustomRoleDto) {
    return this.run(() => this.administrationService.createCustomRole({
      actorUserId: this.actorUserId(request),
      code: dto.code,
      name: dto.name,
      description: dto.description,
    }));
  }

  @Get("roles")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List system and custom roles (requires authorization.read)" })
  listRoles() {
    return this.run(() => this.administrationService.listRoles());
  }

  @Get("roles/:id")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "Get a role; system roles are read-only (requires authorization.read)" })
  getRole(@Param("id") roleId: string) {
    return this.run(() => this.administrationService.getRole(roleId));
  }

  @Patch("roles/:id")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @ApiOperation({ summary: "Update a custom role (requires authorization.manage)" })
  updateRole(
    @Req() request: AuthenticatedRequest,
    @Param("id") roleId: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.run(() => this.administrationService.updateCustomRole(roleId, {
      actorUserId: this.actorUserId(request),
      name: dto.name,
      description: dto.description,
      status: dto.status,
    }));
  }

  @Get("permissions")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List only typed-registry permissions (requires authorization.read)" })
  listPermissions() {
    return this.run(() => this.administrationService.listPermissions());
  }

  @Get("roles/:roleId/permissions")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List a role's known permissions (requires authorization.read)" })
  listRolePermissions(@Param("roleId") roleId: string) {
    return this.run(() => this.administrationService.listRolePermissions(roleId));
  }

  @Post("roles/:roleId/permissions/:permissionId")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Grant a known permission to a custom role (requires authorization.manage)" })
  @ApiNoContentResponse({ description: "The permission was granted." })
  grantRolePermission(
    @Req() request: AuthenticatedRequest,
    @Param("roleId") roleId: string,
    @Param("permissionId") permissionId: string,
  ) {
    return this.run(() => this.administrationService.grantRolePermission(
      this.actorUserId(request),
      roleId,
      permissionId,
    ));
  }

  @Delete("roles/:roleId/permissions/:permissionId")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a permission from a custom role (requires authorization.manage)" })
  @ApiNoContentResponse({ description: "The permission was revoked." })
  revokeRolePermission(
    @Req() request: AuthenticatedRequest,
    @Param("roleId") roleId: string,
    @Param("permissionId") permissionId: string,
  ) {
    return this.run(() => this.administrationService.revokeRolePermission(
      this.actorUserId(request),
      roleId,
      permissionId,
    ));
  }

  @Get("users/:userId/roles")
  @RequirePermissions(Permissions.AUTHORIZATION_READ)
  @ApiOperation({ summary: "List a user's system and custom roles (requires authorization.read)" })
  listUserRoles(@Param("userId") userId: string) {
    return this.run(() => this.administrationService.listUserRoles(userId));
  }

  @Post("users/:userId/roles/:roleId")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Grant an active custom role to an active user (requires authorization.manage)" })
  @ApiNoContentResponse({ description: "The role was granted." })
  grantUserRole(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Param("roleId") roleId: string,
  ) {
    return this.run(() => this.administrationService.grantUserRole(
      this.actorUserId(request),
      userId,
      roleId,
    ));
  }

  @Delete("users/:userId/roles/:roleId")
  @RequirePermissions(Permissions.AUTHORIZATION_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a custom role from a user (requires authorization.manage)" })
  @ApiNoContentResponse({ description: "The role was revoked." })
  revokeUserRole(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Param("roleId") roleId: string,
  ) {
    return this.run(() => this.administrationService.revokeUserRole(
      this.actorUserId(request),
      userId,
      roleId,
    ));
  }

  private actorUserId(request: AuthenticatedRequest): string {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authUser.id;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof AuthorizationAdministrationNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof AuthorizationAdministrationConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof AuthorizationAdministrationForbiddenError) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof AuthorizationAdministrationValidationError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (this.isPrismaKnownError(error)) {
        if (error.code === "P2002") throw new ConflictException("A unique authorization assignment already exists.");
        if (error.code === "P2025") throw new NotFoundException("The requested authorization record was not found.");
        if (error.code === "P2003") throw new UnprocessableEntityException("An authorization relationship is invalid.");
      }
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error
      && typeof (error as { code?: unknown }).code === "string";
  }
}
