export type SessionTerminationOutcome = "confirmed" | "unconfirmed" | "already-ended";

/**
 * The server has no broader logout response contract: a successful logout is
 * exactly a 200 response with this exact JSON body. This check is deliberately
 * shared by every browser flow whose successful mutation ends the current
 * session.
 */
export function isConfirmedSessionTerminationResponse(value: unknown): value is { status: "ok" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length === 1
    && Object.hasOwn(value, "status")
    && (value as { status?: unknown }).status === "ok";
}

/**
 * These failures may arrive after a server-side credential mutation has
 * invalidated the session. They are not confirmation of that outcome, but the
 * protected document must still fail closed rather than retain its shell.
 */
export function isAmbiguousSessionTerminationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("kind" in error)) return false;
  const kind = (error as { kind?: unknown }).kind;
  return kind === "network" || kind === "server";
}

export function sessionTerminationLoginHref(outcome: SessionTerminationOutcome): string {
  return `/login?logout=${outcome}`;
}
