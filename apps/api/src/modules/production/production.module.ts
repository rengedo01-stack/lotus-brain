import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PostProductionUseCase } from "./application/post-production.use-case";
import { PRODUCTION_POSTING_REPOSITORY } from "./application/production-posting.repository";
import { PrismaProductionPostingRepository } from "./infrastructure/prisma-production-posting.repository";
import { ProductionController } from "./presentation/production.controller";

@Module({
  imports: [PrismaModule], controllers: [ProductionController],
  providers: [PostProductionUseCase, { provide: PRODUCTION_POSTING_REPOSITORY, useClass: PrismaProductionPostingRepository }],
})
export class ProductionModule {}
