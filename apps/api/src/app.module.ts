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
import { PrismaModule } from "./prisma/prisma.module";
import { MasterModule } from "./modules/master/master.module";
import { PurchaseModule } from "./modules/purchase/purchase.module";
import { ProductionModule } from "./modules/production/production.module";
import { StocktakeModule } from "./modules/stocktake/stocktake.module";
import { IdentityModule } from "./modules/identity/identity.module";

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
              "req.body.csrfToken",
              "req.body.sessionToken",
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
