import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller";
import {
  type EnvironmentVariables,
  validateEnvironment,
} from "./config/environment";
import { PrismaModule } from "./prisma/prisma.module";
import { PurchaseModule } from "./modules/purchase/purchase.module";
import { ProductionModule } from "./modules/production/production.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        pinoHttp: {
          level: configService.get("LOG_LEVEL", { infer: true }),
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie"],
            remove: true,
          },
        },
      }),
    }),
    PrismaModule,
    PurchaseModule,
    ProductionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
