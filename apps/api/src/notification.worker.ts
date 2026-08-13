import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { NotificationOutboxWorker } from "./modules/notification/application/notification-outbox.worker";

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  context.useLogger(context.get(Logger));
  const worker = context.get(NotificationOutboxWorker);
  const shutdown = () => worker.stop();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await worker.runUntilStopped();
  } finally {
    await context.close();
  }
}

void bootstrap();
