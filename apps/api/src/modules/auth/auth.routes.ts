export function isAuthInfrastructurePath(url: string): boolean {
  const pathname = url.split("?", 1)[0] ?? "";
  return (
    pathname === "/api/v1/docs" ||
    pathname.startsWith("/api/v1/docs/") ||
    pathname === "/api/v1/docs-json"
  );
}
