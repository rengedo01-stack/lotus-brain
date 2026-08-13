export function makeVerificationUrl(publicWebBaseUrl: string, rawToken: string): string {
  const url = new URL("/verify-email", publicWebBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}
