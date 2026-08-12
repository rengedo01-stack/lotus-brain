import { Injectable } from "@nestjs/common";
import { Prisma, type UserStatus } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { SystemRoleCodes } from "../../authorization/authorization.constants";
import { normalizeEmail } from "../../auth/auth.utils";
import {
  IdentityAdministrationConflictError,
  IdentityAdministrationForbiddenError,
  IdentityAdministrationNotFoundError,
  IdentityAdministrationValidationError,
} from "../application/identity-administration.errors";
import type {
  IdentityAdministrationRepository,
  IdentityUserView,
  ListIdentityUsersQuery,
  UpdateUserStatusInput,
} from "../application/identity-administration.repository";

const identityUserSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  deletedAt: true,
} as const;

type IdentityUserRecord = Prisma.UserGetPayload<{ select: typeof identityUserSelect }>;
type TransactionClient = Prisma.TransactionClient;

const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  ACTIVE: ["DISABLED", "LOCKED"],
  DISABLED: ["ACTIVE"],
  LOCKED: ["ACTIVE"],
};

@Injectable()
export class PrismaIdentityAdministrationRepository implements IdentityAdministrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: ListIdentityUsersQuery): Promise<IdentityUserView[]> {
    const users = await this.prisma.user.findMany({
      where: {
        email: query.email === undefined ? undefined : normalizeEmail(query.email),
        status: query.status,
        deletedAt: query.deleted === undefined ? undefined : query.deleted ? { not: null } : null,
      },
      select: identityUserSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return users.map((user) => this.toUserView(user));
  }

  async getUser(userId: string): Promise<IdentityUserView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: identityUserSelect });
    if (user === null) throw new IdentityAdministrationNotFoundError("User was not found.");
    return this.toUserView(user);
  }

  async updateUserStatus(userId: string, input: UpdateUserStatusInput): Promise<IdentityUserView> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, userId);
      this.assertNotSoftDeleted(user);
      await this.assertNotSystemAdminUser(transaction, user.id);
      this.assertAllowedStatusTransition(user.status, input.status);

      const updatedUser = await transaction.user.update({
        where: { id: user.id },
        data: { status: input.status },
        select: identityUserSelect,
      });
      await this.writeAudit(transaction, {
        action: "UPDATE_USER_STATUS",
        actorUserId: input.actorUserId,
        targetUserId: user.id,
        beforeState: this.lifecycleState(user),
        afterState: this.lifecycleState(updatedUser),
      });
      return this.toUserView(updatedUser);
    });
  }

  async softDeleteUser(userId: string, actorUserId: string): Promise<IdentityUserView> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, userId);
      if (user.deletedAt !== null) {
        throw new IdentityAdministrationConflictError("User is already soft-deleted.");
      }
      await this.assertNotSystemAdminUser(transaction, user.id);

      const updatedUser = await transaction.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date() },
        select: identityUserSelect,
      });
      await this.writeAudit(transaction, {
        action: "SOFT_DELETE_USER",
        actorUserId,
        targetUserId: user.id,
        beforeState: this.lifecycleState(user),
        afterState: this.lifecycleState(updatedUser),
      });
      return this.toUserView(updatedUser);
    });
  }

  private async lockUser(transaction: TransactionClient, userId: string): Promise<IdentityUserRecord> {
    const users = await transaction.$queryRaw<IdentityUserRecord[]>(Prisma.sql`
      SELECT "id", "email", "status", "createdAt", "updatedAt", "lastLoginAt", "deletedAt"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `);
    const user = users[0] ?? null;
    if (user === null) throw new IdentityAdministrationNotFoundError("User was not found.");
    return user;
  }

  private async assertNotSystemAdminUser(transaction: TransactionClient, userId: string): Promise<void> {
    const assignment = await transaction.userRole.findFirst({
      where: {
        userId,
        role: { code: SystemRoleCodes.SYSTEM_ADMIN },
      },
      select: { roleId: true },
    });
    if (assignment !== null) {
      throw new IdentityAdministrationForbiddenError(
        "SYSTEM_ADMIN users cannot be changed through the identity administration API.",
      );
    }
  }

  private assertNotSoftDeleted(user: IdentityUserRecord): void {
    if (user.deletedAt !== null) {
      throw new IdentityAdministrationValidationError("Soft-deleted users cannot be changed.");
    }
  }

  private assertAllowedStatusTransition(currentStatus: UserStatus, nextStatus: UserStatus): void {
    if (currentStatus === nextStatus || !ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
      throw new IdentityAdministrationValidationError(
        `The ${currentStatus} to ${nextStatus} user status transition is not allowed.`,
      );
    }
  }

  private toUserView(user: IdentityUserRecord): IdentityUserView {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      deletedAt: user.deletedAt,
    };
  }

  private lifecycleState(user: IdentityUserRecord): Prisma.InputJsonValue {
    return {
      status: user.status,
      deletedAt: user.deletedAt?.toISOString() ?? null,
    };
  }

  private async writeAudit(
    transaction: TransactionClient,
    input: {
      action: "UPDATE_USER_STATUS" | "SOFT_DELETE_USER";
      actorUserId: string;
      targetUserId: string;
      beforeState: Prisma.InputJsonValue;
      afterState: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await transaction.identityAuditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        beforeState: input.beforeState,
        afterState: input.afterState,
      },
    });
  }
}
