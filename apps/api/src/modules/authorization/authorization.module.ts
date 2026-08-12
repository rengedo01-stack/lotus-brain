import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AUTHORIZATION_ADMINISTRATION_REPOSITORY } from "./application/authorization-administration.repository";
import { AuthorizationAdministrationService } from "./application/authorization-administration.service";
import { AUTHORIZATION_REPOSITORY } from "./application/authorization.repository";
import { AuthorizationService } from "./application/authorization.service";
import { AuthorizationGuard } from "./guards/authorization.guard";
import { PrismaAuthorizationRepository } from "./infrastructure/prisma-authorization.repository";
import { AuthorizationAdministrationController } from "./presentation/authorization-administration.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AuthorizationAdministrationController],
  providers: [
    AuthorizationService,
    AuthorizationAdministrationService,
    AuthorizationGuard,
    PrismaAuthorizationRepository,
    { provide: AUTHORIZATION_REPOSITORY, useExisting: PrismaAuthorizationRepository },
    { provide: AUTHORIZATION_ADMINISTRATION_REPOSITORY, useExisting: PrismaAuthorizationRepository },
  ],
  exports: [
    AuthorizationService,
    AuthorizationAdministrationService,
    AuthorizationGuard,
    AUTHORIZATION_REPOSITORY,
    AUTHORIZATION_ADMINISTRATION_REPOSITORY,
  ],
})
export class AuthorizationModule {}
