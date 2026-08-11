import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ConfirmStocktakeUseCase, CreateStocktakeUseCase, GetStocktakeUseCase, PostStocktakeUseCase, UpdateStocktakeUseCase } from "./application/stocktake.use-cases";
import { STOCKTAKE_REPOSITORY } from "./application/stocktake.repository";
import { PrismaStocktakeRepository } from "./infrastructure/prisma-stocktake.repository";
import { StocktakeController } from "./presentation/stocktake.controller";

@Module({
  imports: [PrismaModule],
  controllers: [StocktakeController],
  providers: [
    CreateStocktakeUseCase,
    GetStocktakeUseCase,
    UpdateStocktakeUseCase,
    ConfirmStocktakeUseCase,
    PostStocktakeUseCase,
    { provide: STOCKTAKE_REPOSITORY, useClass: PrismaStocktakeRepository },
  ],
})
export class StocktakeModule {}
