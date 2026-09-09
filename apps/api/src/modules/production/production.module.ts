import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PostProductionUseCase } from "./application/post-production.use-case";
import { PRODUCTION_POSTING_REPOSITORY } from "./application/production-posting.repository";
import { PrismaProductionPostingRepository } from "./infrastructure/prisma-production-posting.repository";
import {
  ConfirmProductionUseCase,
  CreateProductionUseCase,
  GetProductionUseCase,
  UpdateProductionDraftUseCase,
} from "./application/production-lifecycle.use-cases";
import { PRODUCTION_LIFECYCLE_REPOSITORY } from "./application/production-lifecycle.repository";
import { PrismaProductionLifecycleRepository } from "./infrastructure/prisma-production-lifecycle.repository";
import { ListProductionsUseCase } from "./application/list-productions.use-case";
import { PRODUCTION_LIST_REPOSITORY } from "./application/production-list.repository";
import { PrismaProductionListRepository } from "./infrastructure/prisma-production-list.repository";
import { ProductionController } from "./presentation/production.controller";

@Module({
  imports: [PrismaModule], controllers: [ProductionController],
  providers: [
    PostProductionUseCase,
    CreateProductionUseCase,
    GetProductionUseCase,
    UpdateProductionDraftUseCase,
    ConfirmProductionUseCase,
    ListProductionsUseCase,
    { provide: PRODUCTION_POSTING_REPOSITORY, useClass: PrismaProductionPostingRepository },
    { provide: PRODUCTION_LIFECYCLE_REPOSITORY, useClass: PrismaProductionLifecycleRepository },
    { provide: PRODUCTION_LIST_REPOSITORY, useClass: PrismaProductionListRepository },
  ],
})
export class ProductionModule {}
