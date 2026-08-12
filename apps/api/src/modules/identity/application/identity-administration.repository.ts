import type { UserStatus } from "../../../generated/prisma/client";

export const IDENTITY_ADMINISTRATION_REPOSITORY = Symbol("IDENTITY_ADMINISTRATION_REPOSITORY");

export type IdentityUserView = {
  id: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
};

export type ListIdentityUsersQuery = {
  email?: string;
  status?: UserStatus;
  deleted?: boolean;
  limit: number;
  offset: number;
};

export type UpdateUserStatusInput = {
  actorUserId: string;
  status: UserStatus;
};

export interface IdentityAdministrationRepository {
  listUsers(query: ListIdentityUsersQuery): Promise<IdentityUserView[]>;
  getUser(userId: string): Promise<IdentityUserView>;
  updateUserStatus(userId: string, input: UpdateUserStatusInput): Promise<IdentityUserView>;
  softDeleteUser(userId: string, actorUserId: string): Promise<IdentityUserView>;
}
