import { Inject, Injectable } from "@nestjs/common";
import { argon2id, hash } from "argon2";
import { hashSecret, normalizeEmail } from "../../auth/auth.utils";
import { PasswordPolicy } from "../../auth/password.policy";
import {
  USER_INVITATION_REPOSITORY,
  type ListUserInvitationsQuery,
  type UserInvitationRepository,
  type UserInvitationView,
} from "../../notification/application/user-invitation.repository";

@Injectable()
export class UserInvitationService {
  constructor(
    @Inject(USER_INVITATION_REPOSITORY)
    private readonly repository: UserInvitationRepository,
  ) {}

  createInvitation(actorUserId: string, email: string): Promise<UserInvitationView> {
    return this.repository.createInvitation({ actorUserId, email: normalizeEmail(email) });
  }

  listInvitations(query: ListUserInvitationsQuery): Promise<UserInvitationView[]> {
    return this.repository.listInvitations(query);
  }

  getInvitation(invitationId: string): Promise<UserInvitationView> {
    return this.repository.getInvitation(invitationId);
  }

  cancelInvitation(invitationId: string, actorUserId: string): Promise<UserInvitationView> {
    return this.repository.cancelInvitation(invitationId, actorUserId);
  }

  resendInvitation(invitationId: string, actorUserId: string): Promise<void> {
    return this.repository.resendInvitation(invitationId, actorUserId);
  }

  async acceptInvitation(token: string, password: string): Promise<void> {
    PasswordPolicy.assertPassword(password);
    const passwordHash = await hash(password, { type: argon2id });
    await this.repository.acceptInvitation({ tokenHash: hashSecret(token), passwordHash });
  }
}
