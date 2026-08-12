import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { SystemRoleCodes } from "../authorization.constants";
import type {
  AuthorizationRepository,
  GrantSystemAdminResult,
} from "../application/authorization.repository";
import type { PermissionCode } from "../permission.registry";
import { normalizeEmail } from "../../auth/auth.utils";

@Injectable()
export class PrismaAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasAllPermissions(userId: string, permissions: readonly PermissionCode[]): Promise<boolean> {
    if (permissions.length === 0) return false;

    const grantedPermissions = await this.prisma.permission.findMany({
      where: {
        code: { in: [...permissions] },
        rolePermissions: {
          some: {
            role: {
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
      const user = await transaction.user.findUnique({
        where: { email },
        select: { id: true, email: true, status: true, deletedAt: true },
      });
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
}
