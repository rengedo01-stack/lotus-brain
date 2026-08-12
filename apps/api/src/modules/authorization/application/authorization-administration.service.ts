import { Inject, Injectable } from "@nestjs/common";
import {
  AUTHORIZATION_ADMINISTRATION_REPOSITORY,
  type AuthorizationAdministrationRepository,
  type AuthorizationPermissionView,
  type AuthorizationRoleView,
  type CreateCustomRoleInput,
  type UpdateCustomRoleInput,
} from "./authorization-administration.repository";

@Injectable()
export class AuthorizationAdministrationService {
  constructor(
    @Inject(AUTHORIZATION_ADMINISTRATION_REPOSITORY)
    private readonly repository: AuthorizationAdministrationRepository,
  ) {}

  createCustomRole(input: CreateCustomRoleInput): Promise<AuthorizationRoleView> {
    return this.repository.createCustomRole(input);
  }

  listRoles(): Promise<AuthorizationRoleView[]> {
    return this.repository.listRoles();
  }

  getRole(roleId: string): Promise<AuthorizationRoleView> {
    return this.repository.getRole(roleId);
  }

  updateCustomRole(roleId: string, input: UpdateCustomRoleInput): Promise<AuthorizationRoleView> {
    return this.repository.updateCustomRole(roleId, input);
  }

  listPermissions(): Promise<AuthorizationPermissionView[]> {
    return this.repository.listPermissions();
  }

  listRolePermissions(roleId: string): Promise<AuthorizationPermissionView[]> {
    return this.repository.listRolePermissions(roleId);
  }

  grantRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void> {
    return this.repository.grantRolePermission(actorUserId, roleId, permissionId);
  }

  revokeRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void> {
    return this.repository.revokeRolePermission(actorUserId, roleId, permissionId);
  }

  listUserRoles(userId: string): Promise<AuthorizationRoleView[]> {
    return this.repository.listUserRoles(userId);
  }

  grantUserRole(actorUserId: string, userId: string, roleId: string): Promise<void> {
    return this.repository.grantUserRole(actorUserId, userId, roleId);
  }

  revokeUserRole(actorUserId: string, userId: string, roleId: string): Promise<void> {
    return this.repository.revokeUserRole(actorUserId, userId, roleId);
  }
}
