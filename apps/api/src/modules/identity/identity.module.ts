import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationModule } from "../notification/notification.module";
import { IDENTITY_ADMINISTRATION_REPOSITORY } from "./application/identity-administration.repository";
import { IdentityAdministrationService } from "./application/identity-administration.service";
import { PrismaIdentityAdministrationRepository } from "./infrastructure/prisma-identity-administration.repository";
import { IdentityAdministrationController } from "./presentation/identity-administration.controller";
import { UserInvitationService } from "./application/user-invitation.service";
import {
  UserInvitationAcceptanceController,
  UserInvitationAdministrationController,
} from "./presentation/user-invitation.controller";

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [
    IdentityAdministrationController,
    UserInvitationAdministrationController,
    UserInvitationAcceptanceController,
  ],
  providers: [
    IdentityAdministrationService,
    UserInvitationService,
    PrismaIdentityAdministrationRepository,
    { provide: IDENTITY_ADMINISTRATION_REPOSITORY, useExisting: PrismaIdentityAdministrationRepository },
  ],
})
export class IdentityModule {}
