export function makeVerificationUrl(publicWebBaseUrl: string, rawToken: string): string {
  const url = new URL("/verify-email", publicWebBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}

export function makePasswordRecoveryUrl(publicWebBaseUrl: string, rawToken: string): string {
  const url = new URL("/reset-password", publicWebBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}

export function makeUserInvitationUrl(publicWebBaseUrl: string, rawToken: string): string {
  const url = new URL("/accept-invitation", publicWebBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}
