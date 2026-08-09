import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller";
import {
  type EnvironmentVariables,
  validateEnvironment,
} from "./config/environment";
import { PrismaModule } from "./prisma/prisma.module";

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
  ],
  controllers: [AppController],
})
export class AppModule {}
