import { SetMetadata } from "@nestjs/common";
import { AUTH_PENDING_SESSION_ACTIVATION_KEY } from "../auth.constants";

// This marks the sole endpoint served by PendingSessionActivationGuard. It is
// intentionally not public: the guard requires the pending cookie and its
// response-bound CSRF proof before the other global guards stand aside.
export const PendingSessionActivation = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_PENDING_SESSION_ACTIVATION_KEY, true);
