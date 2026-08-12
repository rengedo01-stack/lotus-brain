import { Inject, Injectable } from "@nestjs/common";
import {
  AuthForbiddenError,
  AuthInvalidCredentialsError,
  AuthNotFoundError,
} from "../auth.errors";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type AuthUserView,
  type BootstrapUserInput,
  type LoginInput,
} from "./auth.repository";
import { hashSecret, makeOpaqueToken, normalizeEmail, secondsFromDays } from "../auth.utils";
import { AUTH_SESSION_TTL_DAYS } from "../auth.constants";
import { PasswordPolicy } from "../password.policy";

@Injectable()
export class LoginUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(input: LoginInput): Promise<{ user: AuthUserView; csrfToken: string; sessionToken: string; sessionExpiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.findUserByEmail(email);
    if (user === null) throw new AuthInvalidCredentialsError("Invalid email or password.");
    if (user.status !== "ACTIVE" || user.deletedAt !== null) {
      throw new AuthInvalidCredentialsError("Invalid email or password.");
    }
    if (typeof user.passwordHash !== "string") throw new AuthInvalidCredentialsError("Invalid email or password.");
    const argon2 = await import("argon2");
    const passwordMatches = await argon2.verify(user.passwordHash, input.password);
    if (!passwordMatches) throw new AuthInvalidCredentialsError("Invalid email or password.");

    const sessionToken = makeOpaqueToken();
    const csrfToken = makeOpaqueToken();
    const sessionTokenHash = hashSecret(sessionToken);
    const csrfTokenHash = hashSecret(csrfToken);
    const sessionExpiresAt = new Date(Date.now() + secondsFromDays(AUTH_SESSION_TTL_DAYS) * 1000);

    await this.repository.createSessionAndMarkUserLogin({
      csrfTokenHash,
      credentialVersion: user.credentialVersion,
      expiresAt: sessionExpiresAt,
      ipAddress: input.ipAddress ?? null,
      tokenHash: sessionTokenHash,
      userAgent: input.userAgent ?? null,
      userId: user.id,
    });
    const { passwordHash, deletedAt, credentialVersion, ...safeUser } = user;
    void passwordHash;
    void deletedAt;
    void credentialVersion;
    return { user: safeUser, csrfToken, sessionToken, sessionExpiresAt };
  }
}

@Injectable()
export class ChangePasswordUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(input: { userId: string; currentPassword: string; newPassword: string }): Promise<void> {
    PasswordPolicy.assertChange(input.currentPassword, input.newPassword);

    const user = await this.repository.findUserCredentialById(input.userId);
    if (user === null || user.status !== "ACTIVE" || user.deletedAt !== null) {
      throw new AuthInvalidCredentialsError("Invalid credentials.");
    }

    const argon2 = await import("argon2");
    const passwordMatches = await argon2.verify(user.passwordHash, input.currentPassword);
    if (!passwordMatches) throw new AuthInvalidCredentialsError("Invalid credentials.");

    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await this.repository.changePassword({
      userId: user.id,
      expectedCredentialVersion: user.credentialVersion,
      passwordHash,
    });
  }
}

@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(userId: string): Promise<AuthUserView> {
    const user = await this.repository.findUserById(userId);
    if (user === null) throw new AuthNotFoundError(`User ${userId} was not found.`);
    return user;
  }
}

@Injectable()
export class RotateCsrfTokenUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(sessionId: string): Promise<string> {
    const csrfToken = makeOpaqueToken();
    const result = await this.repository.rotateSessionCsrfToken(sessionId, hashSecret(csrfToken));
    if (result === null) throw new AuthNotFoundError(`Session ${sessionId} was not found.`);
    return csrfToken;
  }
}

@Injectable()
export class LogoutUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(sessionId: string): Promise<void> {
    const revoked = await this.repository.revokeSession(sessionId);
    if (!revoked) throw new AuthNotFoundError(`Session ${sessionId} was not found.`);
  }
}

@Injectable()
export class BootstrapUserUseCase {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async execute(input: BootstrapUserInput): Promise<AuthUserView> {
    const userCount = await this.repository.getUserCount();
    if (userCount > 0) {
      throw new AuthForbiddenError("A user already exists; bootstrap is only allowed once.");
    }
    PasswordPolicy.assertPassword(input.password);
    const argon2 = await import("argon2");
    return this.repository.bootstrapUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
    });
  }
}
