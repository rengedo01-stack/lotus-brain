import { SetMetadata } from "@nestjs/common";
import { AUTH_PUBLIC_KEY } from "../auth.constants";

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_PUBLIC_KEY, true);
