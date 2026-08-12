import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AUTHORIZATION_REPOSITORY } from "./application/authorization.repository";
import { AuthorizationService } from "./application/authorization.service";
import { AuthorizationGuard } from "./guards/authorization.guard";
import { PrismaAuthorizationRepository } from "./infrastructure/prisma-authorization.repository";

@Module({
  imports: [PrismaModule],
  providers: [
    AuthorizationService,
    AuthorizationGuard,
    { provide: AUTHORIZATION_REPOSITORY, useClass: PrismaAuthorizationRepository },
  ],
  exports: [AuthorizationService, AuthorizationGuard, AUTHORIZATION_REPOSITORY],
})
export class AuthorizationModule {}
