import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { SystemRoleCodes } from "../authorization.constants";
import {
  AuthorizationAdministrationForbiddenError,
  AuthorizationAdministrationNotFoundError,
  AuthorizationAdministrationValidationError,
} from "../application/authorization-administration.errors";
import type {
  AuthorizationAdministrationRepository,
  AuthorizationPermissionView,
  AuthorizationRoleView,
  CreateCustomRoleInput,
  UpdateCustomRoleInput,
} from "../application/authorization-administration.repository";
import type {
  AuthorizationRepository,
  GrantSystemAdminResult,
} from "../application/authorization.repository";
import {
  ALL_PERMISSION_CODES,
  getPermissionDefinition,
  isKnownPermissionCode,
  type PermissionCode,
} from "../permission.registry";
import { normalizeEmail } from "../../auth/auth.utils";

const roleSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const permissionSelect = {
  id: true,
  code: true,
} as const;

type RoleRecord = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;
type PermissionRecord = Prisma.PermissionGetPayload<{ select: typeof permissionSelect }>;
type TransactionClient = Prisma.TransactionClient;

const CUSTOM_ROLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

@Injectable()
export class PrismaAuthorizationRepository
  implements AuthorizationRepository, AuthorizationAdministrationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async hasAllPermissions(userId: string, permissions: readonly PermissionCode[]): Promise<boolean> {
    if (permissions.length === 0) return false;

    const grantedPermissions = await this.prisma.permission.findMany({
      where: {
        code: { in: [...permissions] },
        rolePermissions: {
          some: {
            role: {
              status: "ACTIVE",
              userRoles: { some: { userId } },
            },
          },
        },
      },
      select: { code: true },
    });

    return grantedPermissions.length === permissions.length;
  }

  async grantSystemAdminByEmail(inputEmail: string): Promise<GrantSystemAdminResult> {
    const email = normalizeEmail(inputEmail);

    return this.prisma.$transaction(async (transaction) => {
      // Serialize SYSTEM_ADMIN grants with identity lifecycle mutations. Both
      // paths lock this User row before checking eligibility or assignments.
      const lockedUsers = await transaction.$queryRaw<Array<{
        id: string;
        email: string;
        status: "ACTIVE" | "DISABLED" | "LOCKED";
        deletedAt: Date | null;
      }>>(Prisma.sql`
        SELECT "id", "email", "status", "deletedAt"
        FROM "User"
        WHERE "email" = ${email}
        FOR UPDATE
      `);
      const user = lockedUsers[0] ?? null;
      if (user === null) return { kind: "USER_NOT_FOUND", email };
      if (user.status !== "ACTIVE" || user.deletedAt !== null) {
        return { kind: "USER_INELIGIBLE", email };
      }

      const systemAdminRole = await transaction.role.findUnique({
        where: { code: SystemRoleCodes.SYSTEM_ADMIN },
        select: { id: true },
      });
      if (systemAdminRole === null) {
        throw new Error("SYSTEM_ADMIN role is not configured. Apply the RBAC migration before granting access.");
      }

      const assignment = await transaction.userRole.createMany({
        data: { userId: user.id, roleId: systemAdminRole.id },
        skipDuplicates: true,
      });
      if (assignment.count === 0) return { kind: "ALREADY_ASSIGNED", email: user.email };

      await transaction.authorizationAuditLog.create({
        data: {
          action: "GRANT_SYSTEM_ADMIN",
          source: "SERVER_CLI",
          targetUserId: user.id,
          roleId: systemAdminRole.id,
        },
      });
      return { kind: "GRANTED", email: user.email };
    });
  }

  async createCustomRole(input: CreateCustomRoleInput): Promise<AuthorizationRoleView> {
    this.assertCreateInput(input);

    return this.prisma.$transaction(async (transaction) => {
      const role = await transaction.role.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          status: "ACTIVE",
        },
        select: roleSelect,
      });
      await this.writeAdministrationAudit(transaction, {
        action: "CREATE_CUSTOM_ROLE",
        actorUserId: input.actorUserId,
        roleId: role.id,
        afterState: this.roleState(role),
      });
      return this.toRoleView(role);
    });
  }

  async listRoles(): Promise<AuthorizationRoleView[]> {
    const roles = await this.prisma.role.findMany({
      select: roleSelect,
      orderBy: [{ code: "asc" }, { id: "asc" }],
    });
    return roles.map((role) => this.toRoleView(role));
  }

  async getRole(roleId: string): Promise<AuthorizationRoleView> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: roleSelect });
    if (role === null) throw new AuthorizationAdministrationNotFoundError("Role was not found.");
    return this.toRoleView(role);
  }

  async updateCustomRole(roleId: string, input: UpdateCustomRoleInput): Promise<AuthorizationRoleView> {
    if (input.name === undefined && input.description === undefined && input.status === undefined) {
      throw new AuthorizationAdministrationValidationError("At least one mutable role field is required.");
    }
    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new AuthorizationAdministrationValidationError("Role name cannot be empty.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const role = await this.getMutableCustomRole(transaction, roleId);
      const updatedRole = await transaction.role.update({
        where: { id: role.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
        },
        select: roleSelect,
      });
      await this.writeAdministrationAudit(transaction, {
        action: "UPDATE_CUSTOM_ROLE",
        actorUserId: input.actorUserId,
        roleId: role.id,
        beforeState: this.roleState(role),
        afterState: this.roleState(updatedRole),
      });
      return this.toRoleView(updatedRole);
    });
  }

  async listPermissions(): Promise<AuthorizationPermissionView[]> {
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: [...ALL_PERMISSION_CODES] } },
      select: permissionSelect,
      orderBy: [{ code: "asc" }, { id: "asc" }],
    });
    return permissions.flatMap((permission) => {
      const view = this.toPermissionView(permission);
      return view === null ? [] : [view];
    });
  }

  async listRolePermissions(roleId: string): Promise<AuthorizationPermissionView[]> {
    await this.getRoleOrThrow(this.prisma, roleId);
    const assignments = await this.prisma.rolePermission.findMany({
      where: { roleId, permission: { code: { in: [...ALL_PERMISSION_CODES] } } },
      select: { permission: { select: permissionSelect } },
      orderBy: [{ permission: { code: "asc" } }, { permissionId: "asc" }],
    });
    return assignments.flatMap(({ permission }) => {
      const view = this.toPermissionView(permission);
      return view === null ? [] : [view];
    });
  }

  async grantRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const role = await this.getMutableCustomRole(transaction, roleId);
      const permission = await this.getKnownPermissionOrThrow(transaction, permissionId);
      const definition = getPermissionDefinition(permission.code);
      if (!definition.customRoleAssignable) {
        throw new AuthorizationAdministrationValidationError(
          "This permission cannot be assigned to a custom role.",
        );
      }

      await transaction.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      await this.writeAdministrationAudit(transaction, {
        action: "GRANT_ROLE_PERMISSION",
        actorUserId,
        roleId: role.id,
        permissionId: permission.id,
      });
    });
  }

  async revokeRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const role = await this.getMutableCustomRole(transaction, roleId);
      const permission = await this.getKnownPermissionOrThrow(transaction, permissionId);
      const deleted = await transaction.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: permission.id },
      });
      if (deleted.count === 0) {
        throw new AuthorizationAdministrationNotFoundError("Role permission assignment was not found.");
      }
      await this.writeAdministrationAudit(transaction, {
        action: "REVOKE_ROLE_PERMISSION",
        actorUserId,
        roleId: role.id,
        permissionId: permission.id,
      });
    });
  }

  async listUserRoles(userId: string): Promise<AuthorizationRoleView[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        userRoles: {
          select: { role: { select: roleSelect } },
          orderBy: [{ role: { code: "asc" } }, { roleId: "asc" }],
        },
      },
    });
    if (user === null) throw new AuthorizationAdministrationNotFoundError("User was not found.");
    return user.userRoles.map(({ role }) => this.toRoleView(role));
  }

  async grantUserRole(actorUserId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const role = await this.getMutableCustomRole(transaction, roleId);
      if (role.status !== "ACTIVE") {
        throw new AuthorizationAdministrationValidationError("Disabled roles cannot be assigned to users.");
      }

      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, deletedAt: true },
      });
      if (user === null) throw new AuthorizationAdministrationNotFoundError("User was not found.");
      if (user.status !== "ACTIVE" || user.deletedAt !== null) {
        throw new AuthorizationAdministrationValidationError(
          "Only active, non-deleted users can receive a custom role.",
        );
      }

      await transaction.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await this.writeAdministrationAudit(transaction, {
        action: "GRANT_USER_ROLE",
        actorUserId,
        targetUserId: user.id,
        roleId: role.id,
      });
    });
  }

  async revokeUserRole(actorUserId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const role = await this.getMutableCustomRole(transaction, roleId);
      const user = await transaction.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (user === null) throw new AuthorizationAdministrationNotFoundError("User was not found.");

      const deleted = await transaction.userRole.deleteMany({
        where: { userId: user.id, roleId: role.id },
      });
      if (deleted.count === 0) {
        throw new AuthorizationAdministrationNotFoundError("User role assignment was not found.");
      }
      await this.writeAdministrationAudit(transaction, {
        action: "REVOKE_USER_ROLE",
        actorUserId,
        targetUserId: user.id,
        roleId: role.id,
      });
    });
  }

  private async getRoleOrThrow(
    client: Pick<PrismaService, "role"> | TransactionClient,
    roleId: string,
  ): Promise<RoleRecord> {
    const role = await client.role.findUnique({ where: { id: roleId }, select: roleSelect });
    if (role === null) throw new AuthorizationAdministrationNotFoundError("Role was not found.");
    return role;
  }

  private async getMutableCustomRole(transaction: TransactionClient, roleId: string): Promise<RoleRecord> {
    const role = await this.getRoleOrThrow(transaction, roleId);
    if (role.isSystem) {
      throw new AuthorizationAdministrationForbiddenError("System roles are read-only through this API.");
    }
    return role;
  }

  private async getKnownPermissionOrThrow(
    transaction: TransactionClient,
    permissionId: string,
  ): Promise<PermissionRecord & { code: PermissionCode }> {
    const permission = await transaction.permission.findUnique({
      where: { id: permissionId },
      select: permissionSelect,
    });
    if (permission === null || !isKnownPermissionCode(permission.code)) {
      throw new AuthorizationAdministrationNotFoundError("Permission was not found.");
    }
    return { ...permission, code: permission.code };
  }

  private toRoleView(role: RoleRecord): AuthorizationRoleView {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private toPermissionView(permission: PermissionRecord): AuthorizationPermissionView | null {
    if (!isKnownPermissionCode(permission.code)) return null;
    const definition = getPermissionDefinition(permission.code);
    return {
      id: permission.id,
      code: permission.code,
      description: definition.description,
      customRoleAssignable: definition.customRoleAssignable,
    };
  }

  private roleState(role: RoleRecord): Prisma.InputJsonValue {
    return {
      name: role.name,
      description: role.description,
      status: role.status,
    };
  }

  private async writeAdministrationAudit(
    transaction: TransactionClient,
    input: {
      action:
        | "CREATE_CUSTOM_ROLE"
        | "UPDATE_CUSTOM_ROLE"
        | "GRANT_ROLE_PERMISSION"
        | "REVOKE_ROLE_PERMISSION"
        | "GRANT_USER_ROLE"
        | "REVOKE_USER_ROLE";
      actorUserId: string;
      targetUserId?: string;
      roleId?: string;
      permissionId?: string;
      beforeState?: Prisma.InputJsonValue;
      afterState?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await transaction.authorizationAuditLog.create({
      data: {
        action: input.action,
        source: "AUTHORIZATION_API",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        roleId: input.roleId,
        permissionId: input.permissionId,
        beforeState: input.beforeState,
        afterState: input.afterState,
      },
    });
  }

  private assertCreateInput(input: CreateCustomRoleInput): void {
    if (!CUSTOM_ROLE_CODE.test(input.code)) {
      throw new AuthorizationAdministrationValidationError(
        "Role code must be uppercase letters, digits, and underscores, starting with a letter.",
      );
    }
    if (input.name.trim().length === 0) {
      throw new AuthorizationAdministrationValidationError("Role name cannot be empty.");
    }
  }
}
