import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import {
  ActivateSessionUseCase,
  LoginUseCase,
  LogoutUseCase,
  RotateCsrfTokenUseCase,
  GetCurrentUserUseCase,
  BootstrapUserUseCase,
  ChangePasswordUseCase,
} from "./application/auth.use-cases";
import { AUTH_REPOSITORY } from "./application/auth.repository";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository";
import { AuthController } from "./presentation/auth.controller";
import { PasskeyController } from "./presentation/passkey.controller";
import { PasskeyEnrollmentService } from "./application/passkey-enrollment.service";
import { PASSKEY_ENROLLMENT_REPOSITORY } from "./application/passkey-enrollment.repository";
import { PASSKEY_WEBAUTHN_ADAPTER } from "./application/passkey-webauthn.adapter";
import { PrismaPasskeyEnrollmentRepository } from "./infrastructure/prisma-passkey-enrollment.repository";
import { SimpleWebAuthnPasskeyAdapter } from "./infrastructure/simplewebauthn-passkey.adapter";
import { PasskeyMfaService } from "./application/passkey-mfa.service";
import { PASSKEY_MFA_REPOSITORY } from "./application/passkey-mfa.repository";
import { PrismaPasskeyMfaRepository } from "./infrastructure/prisma-passkey-mfa.repository";
import { PasskeyMfaController, PasskeyMfaLoginController } from "./presentation/passkey-mfa.controller";

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [AuthController, PasskeyController, PasskeyMfaController, PasskeyMfaLoginController],
  providers: [
    ActivateSessionUseCase,
    LoginUseCase,
    ChangePasswordUseCase,
    GetCurrentUserUseCase,
    RotateCsrfTokenUseCase,
    LogoutUseCase,
    BootstrapUserUseCase,
    PasskeyEnrollmentService,
    PasskeyMfaService,
    PrismaPasskeyEnrollmentRepository,
    PrismaPasskeyMfaRepository,
    SimpleWebAuthnPasskeyAdapter,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
    { provide: PASSKEY_ENROLLMENT_REPOSITORY, useExisting: PrismaPasskeyEnrollmentRepository },
    { provide: PASSKEY_MFA_REPOSITORY, useExisting: PrismaPasskeyMfaRepository },
    { provide: PASSKEY_WEBAUTHN_ADAPTER, useExisting: SimpleWebAuthnPasskeyAdapter },
  ],
  exports: [
    AUTH_REPOSITORY,
    ActivateSessionUseCase,
    LoginUseCase,
    ChangePasswordUseCase,
    GetCurrentUserUseCase,
    RotateCsrfTokenUseCase,
    LogoutUseCase,
    BootstrapUserUseCase,
    PasskeyEnrollmentService,
    PasskeyMfaService,
    PASSKEY_ENROLLMENT_REPOSITORY,
    PASSKEY_MFA_REPOSITORY,
    PASSKEY_WEBAUTHN_ADAPTER,
  ],
})
export class AuthModule {}
