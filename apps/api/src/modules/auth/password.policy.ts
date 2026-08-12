import { AuthValidationError } from "./auth.errors";

export const PASSWORD_MINIMUM_CODE_POINTS = 15;
export const PASSWORD_MAXIMUM_CODE_POINTS = 128;

/**
 * Application-owned policy for every newly set password. Existing credentials
 * are intentionally not migrated or invalidated merely because this policy is
 * introduced.
 */
export class PasswordPolicy {
  static assertPassword(password: string): void {
    const codePointLength = Array.from(password).length;
    if (codePointLength < PASSWORD_MINIMUM_CODE_POINTS || codePointLength > PASSWORD_MAXIMUM_CODE_POINTS) {
      throw new AuthValidationError(
        `Password must contain between ${PASSWORD_MINIMUM_CODE_POINTS} and ${PASSWORD_MAXIMUM_CODE_POINTS} Unicode code points.`,
      );
    }
  }

  static assertChange(currentPassword: string, newPassword: string): void {
    this.assertPassword(newPassword);
    if (newPassword === currentPassword) {
      throw new AuthValidationError("New password must differ from the current password.");
    }
  }
}
