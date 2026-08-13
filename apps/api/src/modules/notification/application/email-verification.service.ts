import { Inject, Injectable } from "@nestjs/common";
import { hashSecret } from "../../auth/auth.utils";
import { RECOVERY_CHANNEL_REPOSITORY, type RecoveryChannelRepository } from "./recovery-channel.repository";

@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(RECOVERY_CHANNEL_REPOSITORY)
    private readonly repository: RecoveryChannelRepository,
  ) {}

  request(userId: string): Promise<void> {
    return this.repository.requestEmailVerification(userId);
  }

  confirm(rawToken: string): Promise<void> {
    return this.repository.confirmEmailVerification(hashSecret(rawToken));
  }
}
