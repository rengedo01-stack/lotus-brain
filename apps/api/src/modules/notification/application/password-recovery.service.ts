import { Inject, Injectable } from "@nestjs/common";
import { AuthValidationError } from "../../auth/auth.errors";
import { hashSecret, normalizeEmail } from "../../auth/auth.utils";
import { PasswordPolicy } from "../../auth/password.policy";
import { PasswordRecoveryTokenInvalidError } from "./recovery-channel.errors";
import { RECOVERY_CHANNEL_REPOSITORY, type RecoveryChannelRepository } from "./recovery-channel.repository";

// Non-secret fixed Argon2id digest. Every public recovery request verifies it
// before the lookup, so the eligible path's outbox/audit writes do not create a
// readily measurable account-existence timing oracle. The existing per-IP and
// per-canonical-email throttles bound this deliberately expensive work.
const PASSWORD_RECOVERY_TIMING_DIGEST =
  "$argon2id$v=19$m=65536,t=3,p=4$Q29uc3RhbnQgcmVjb3ZlcnkgdGltaW5nIHNhbHQ$C4SIzvldJmkh7Yk0JKQYIlnTNnC1T6Q9b6xAHybDSqY";

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @Inject(RECOVERY_CHANNEL_REPOSITORY)
    private readonly repository: RecoveryChannelRepository,
  ) {}

  async request(rawEmail: string): Promise<void> {
    const canonicalEmail = normalizeEmail(rawEmail);
    const argon2 = await import("argon2");
    await argon2.verify(PASSWORD_RECOVERY_TIMING_DIGEST, canonicalEmail);
    await this.repository.requestPasswordRecovery(canonicalEmail);
  }

  async reset(rawToken: string, newPassword: string): Promise<void> {
    // Validate the submitted password before inspecting the credential, so an
    // invalid password cannot act as a recovery-token validity oracle.
    PasswordPolicy.assertPassword(newPassword);
    const tokenHash = hashSecret(rawToken);
    const preparation = await this.repository.preparePasswordReset(tokenHash);
    if (preparation === null) {
      throw new PasswordRecoveryTokenInvalidError("Recovery credential is invalid or expired.");
    }

    const argon2 = await import("argon2");
    if (await argon2.verify(preparation.passwordHash, newPassword)) {
      throw new AuthValidationError("New password must differ from the current password.");
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.repository.completePasswordReset({ tokenHash, passwordHash });
  }
}
