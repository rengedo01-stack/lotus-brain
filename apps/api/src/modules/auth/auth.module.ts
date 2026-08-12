import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LoginUseCase, LogoutUseCase, RotateCsrfTokenUseCase, GetCurrentUserUseCase, BootstrapUserUseCase } from "./application/auth.use-cases";
import { AUTH_REPOSITORY } from "./application/auth.repository";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository";
import { AuthController } from "./presentation/auth.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    LoginUseCase,
    GetCurrentUserUseCase,
    RotateCsrfTokenUseCase,
    LogoutUseCase,
    BootstrapUserUseCase,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
  ],
  exports: [AUTH_REPOSITORY, LoginUseCase, GetCurrentUserUseCase, RotateCsrfTokenUseCase, LogoutUseCase, BootstrapUserUseCase],
})
export class AuthModule {}
