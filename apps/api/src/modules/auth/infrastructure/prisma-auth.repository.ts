import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  AuthRepository,
  AuthSessionUserView,
  AuthSessionView,
  AuthUserView,
} from "../application/auth.repository";
import { normalizeEmail } from "../auth.utils";

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const sessionUserSelect = {
  ...userSelect,
  deletedAt: true,
} as const;

const sessionSelect = {
  id: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  csrfTokenHash: true,
  lastSeenAt: true,
} as const;

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<(AuthUserView & { passwordHash: string }) | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { ...userSelect, passwordHash: true },
    });
  }

  async findUserById(id: string): Promise<AuthUserView | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<
    (AuthSessionView & { user: AuthSessionUserView | null }) | null
  > {
    return this.prisma.identitySession.findUnique({
      where: { tokenHash },
      select: {
        ...sessionSelect,
        user: { select: sessionUserSelect },
      },
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthSessionView> {
    return this.prisma.identitySession.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        csrfTokenHash: input.csrfTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
      select: sessionSelect,
    });
  }

  async rotateSessionCsrfToken(sessionId: string, csrfTokenHash: string): Promise<AuthSessionView | null> {
    const result = await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: {
        csrfTokenHash,
        lastSeenAt: new Date(),
      },
    });
    if (result.count === 0) return null;
    return this.prisma.identitySession.findUnique({
      where: { id: sessionId },
      select: sessionSelect,
    });
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async touchSession(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt },
    });
  }

  async markUserLogin(userId: string, loggedInAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: loggedInAt },
    });
  }

  async getUserCount(): Promise<number> {
    return this.prisma.user.count();
  }

  async bootstrapUser(input: { email: string; displayName: string; passwordHash: string }): Promise<AuthUserView> {
    return this.prisma.user.create({
      data: {
        email: normalizeEmail(input.email),
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      },
      select: userSelect,
    });
  }
}
