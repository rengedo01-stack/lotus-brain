import { SetMetadata } from "@nestjs/common";
import { AUTHENTICATED_ONLY_KEY } from "../authorization.constants";

export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
