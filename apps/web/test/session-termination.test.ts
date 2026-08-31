import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-client.ts";
import {
  isAmbiguousSessionTerminationError,
  isConfirmedSessionTerminationResponse,
  sessionTerminationLoginHref,
} from "../lib/session-termination.ts";

test("a session-termination success is only the exact status-ok root response", () => {
  assert.equal(isConfirmedSessionTerminationResponse({ status: "ok" }), true);
  assert.equal(isConfirmedSessionTerminationResponse({ status: "ok", extra: true }), false);
  assert.equal(isConfirmedSessionTerminationResponse({ status: "ended" }), false);
  assert.equal(isConfirmedSessionTerminationResponse({}), false);
  assert.equal(isConfirmedSessionTerminationResponse(null), false);
  assert.equal(isConfirmedSessionTerminationResponse([]), false);
});

test("only response-loss ambiguities fail closed for a credential termination mutation", () => {
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("network")), true);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("server", 500)), true);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("server", 201)), true);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("unauthorized", 401)), false);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("forbidden", 403)), false);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("conflict", 409)), false);
  assert.equal(isAmbiguousSessionTerminationError(new ApiError("validation", 422)), false);
});

test("login notices distinguish confirmed logout, ended sessions, and ambiguous server state", () => {
  assert.equal(sessionTerminationLoginHref("confirmed"), "/login?logout=confirmed");
  assert.equal(sessionTerminationLoginHref("already-ended"), "/login?logout=already-ended");
  assert.equal(sessionTerminationLoginHref("unconfirmed"), "/login?logout=unconfirmed");
});
