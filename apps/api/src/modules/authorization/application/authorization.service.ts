import { Inject, Injectable } from "@nestjs/common";
import {
  AUTHORIZATION_REPOSITORY,
  type AuthorizationRepository,
  type GrantSystemAdminResult,
} from "./authorization.repository";
import type { PermissionCode } from "../permission.registry";

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: AuthorizationRepository,
  ) {}

  hasAllPermissions(userId: string, permissions: readonly PermissionCode[]): Promise<boolean> {
    return this.repository.hasAllPermissions(userId, permissions);
  }

  grantSystemAdminByEmail(email: string): Promise<GrantSystemAdminResult> {
    return this.repository.grantSystemAdminByEmail(email);
  }
}
