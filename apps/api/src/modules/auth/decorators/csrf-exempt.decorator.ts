import { SetMetadata } from "@nestjs/common";
import { AUTH_CSRF_EXEMPT_KEY } from "../auth.constants";

export const CsrfExempt = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_CSRF_EXEMPT_KEY, true);
