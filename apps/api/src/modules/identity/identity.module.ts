import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { IDENTITY_ADMINISTRATION_REPOSITORY } from "./application/identity-administration.repository";
import { IdentityAdministrationService } from "./application/identity-administration.service";
import { PrismaIdentityAdministrationRepository } from "./infrastructure/prisma-identity-administration.repository";
import { IdentityAdministrationController } from "./presentation/identity-administration.controller";

@Module({
  imports: [PrismaModule],
  controllers: [IdentityAdministrationController],
  providers: [
    IdentityAdministrationService,
    PrismaIdentityAdministrationRepository,
    { provide: IDENTITY_ADMINISTRATION_REPOSITORY, useExisting: PrismaIdentityAdministrationRepository },
  ],
})
export class IdentityModule {}
