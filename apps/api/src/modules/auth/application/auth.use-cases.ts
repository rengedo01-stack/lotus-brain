import { Inject, Injectable } from "@nestjs/common";
import { AuthForbiddenError, AuthInvalidCredentialsError, AuthNotFoundError } from "../auth.errors";
import { AUTH_REPOSITORY, type AuthRepository, type AuthUserView, type BootstrapUserInput, type LoginInput } from "./auth.repository";
import { hashSecret, makeOpaqueToken, normalizeEmail, secondsFromDays } from "../auth.utils";
import { AUTH_SESSION_TTL_DAYS } from "../auth.constants";

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

    await this.repository.createSession({
      csrfTokenHash,
      expiresAt: sessionExpiresAt,
      ipAddress: input.ipAddress ?? null,
      tokenHash: sessionTokenHash,
      userAgent: input.userAgent ?? null,
      userId: user.id,
    });
    await this.repository.markUserLogin(user.id, new Date());
    const { passwordHash, deletedAt, ...safeUser } = user;
    void passwordHash;
    void deletedAt;
    return { user: safeUser, csrfToken, sessionToken, sessionExpiresAt };
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
    const argon2 = await import("argon2");
    return this.repository.bootstrapUser({
      ...input,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
    });
  }
}
