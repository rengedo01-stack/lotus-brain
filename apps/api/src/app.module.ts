import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller";
import {
  type EnvironmentVariables,
  validateEnvironment,
} from "./config/environment";
import { AuthModule } from "./modules/auth/auth.module";
import { CsrfGuard } from "./modules/auth/guards/csrf.guard";
import { SessionAuthGuard } from "./modules/auth/guards/session-auth.guard";
import { AuthorizationGuard } from "./modules/authorization/guards/authorization.guard";
import { AuthorizationModule } from "./modules/authorization/authorization.module";
import { LOGIN_THROTTLE_LIMIT, LOGIN_THROTTLE_TTL_MS } from "./modules/auth/auth.constants";
import { hashSecret, normalizeEmail } from "./modules/auth/auth.utils";
import {
  PASSWORD_RECOVERY_EMAIL_THROTTLE_LIMIT,
  PASSWORD_RECOVERY_EMAIL_THROTTLE_TTL_MS,
} from "./modules/notification/notification.constants";
import { PrismaModule } from "./prisma/prisma.module";
import { MasterModule } from "./modules/master/master.module";
import { PurchaseModule } from "./modules/purchase/purchase.module";
import { ProductionModule } from "./modules/production/production.module";
import { StocktakeModule } from "./modules/stocktake/stocktake.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { NotificationModule } from "./modules/notification/notification.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        limit: LOGIN_THROTTLE_LIMIT,
        ttl: LOGIN_THROTTLE_TTL_MS,
      },
      {
        name: "passwordRecoveryEmail",
        limit: PASSWORD_RECOVERY_EMAIL_THROTTLE_LIMIT,
        ttl: PASSWORD_RECOVERY_EMAIL_THROTTLE_TTL_MS,
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
          const pathname = (request.originalUrl ?? request.url ?? "").split("?", 1)[0];
          return pathname !== "/api/v1/auth/password/recovery/request";
        },
        getTracker: (request) => {
          const rawEmail = typeof request.body?.email === "string" ? request.body.email : "";
          return `password-recovery-email:${hashSecret(normalizeEmail(rawEmail))}`;
        },
      },
    ]),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        pinoHttp: {
          level: configService.get("LOG_LEVEL", { infer: true }),
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['x-csrf-token']",
              "res.headers['set-cookie']",
              "req.body.password",
              "req.body.currentPassword",
              "req.body.newPassword",
              "req.body.passwordHash",
              "req.body.token",
              "req.body.verificationToken",
              "req.body.resetToken",
              "req.body.recoveryToken",
              "req.body.csrfToken",
              "req.body.sessionToken",
              "SMTP_PASSWORD",
            ],
            remove: true,
          },
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    IdentityModule,
    NotificationModule,
    MasterModule,
    PurchaseModule,
    ProductionModule,
    StocktakeModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthorizationGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
