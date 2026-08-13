import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import {
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

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, PasskeyController],
  providers: [
    LoginUseCase,
    ChangePasswordUseCase,
    GetCurrentUserUseCase,
    RotateCsrfTokenUseCase,
    LogoutUseCase,
    BootstrapUserUseCase,
    PasskeyEnrollmentService,
    PrismaPasskeyEnrollmentRepository,
    SimpleWebAuthnPasskeyAdapter,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
    { provide: PASSKEY_ENROLLMENT_REPOSITORY, useExisting: PrismaPasskeyEnrollmentRepository },
    { provide: PASSKEY_WEBAUTHN_ADAPTER, useExisting: SimpleWebAuthnPasskeyAdapter },
  ],
  exports: [
    AUTH_REPOSITORY,
    LoginUseCase,
    ChangePasswordUseCase,
    GetCurrentUserUseCase,
    RotateCsrfTokenUseCase,
    LogoutUseCase,
    BootstrapUserUseCase,
    PasskeyEnrollmentService,
    PASSKEY_ENROLLMENT_REPOSITORY,
    PASSKEY_WEBAUTHN_ADAPTER,
  ],
})
export class AuthModule {}
