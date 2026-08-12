import { Inject, Injectable } from "@nestjs/common";
import {
  IDENTITY_ADMINISTRATION_REPOSITORY,
  type IdentityAdministrationRepository,
  type IdentityUserView,
  type ListIdentityUsersQuery,
  type UpdateUserStatusInput,
} from "./identity-administration.repository";

@Injectable()
export class IdentityAdministrationService {
  constructor(
    @Inject(IDENTITY_ADMINISTRATION_REPOSITORY)
    private readonly repository: IdentityAdministrationRepository,
  ) {}

  listUsers(query: ListIdentityUsersQuery): Promise<IdentityUserView[]> {
    return this.repository.listUsers(query);
  }

  getUser(userId: string): Promise<IdentityUserView> {
    return this.repository.getUser(userId);
  }

  updateUserStatus(userId: string, input: UpdateUserStatusInput): Promise<IdentityUserView> {
    return this.repository.updateUserStatus(userId, input);
  }

  softDeleteUser(userId: string, actorUserId: string): Promise<IdentityUserView> {
    return this.repository.softDeleteUser(userId, actorUserId);
  }
}
