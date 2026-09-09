import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ConfirmStocktakeUseCase, CreateStocktakeUseCase, GetStocktakeUseCase, PostStocktakeUseCase, UpdateStocktakeUseCase } from "./application/stocktake.use-cases";
import { STOCKTAKE_REPOSITORY } from "./application/stocktake.repository";
import { PrismaStocktakeRepository } from "./infrastructure/prisma-stocktake.repository";
import { ListStocktakesUseCase } from "./application/list-stocktakes.use-case";
import { STOCKTAKE_LIST_REPOSITORY } from "./application/stocktake-list.repository";
import { PrismaStocktakeListRepository } from "./infrastructure/prisma-stocktake-list.repository";
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
    ListStocktakesUseCase,
    { provide: STOCKTAKE_REPOSITORY, useClass: PrismaStocktakeRepository },
    { provide: STOCKTAKE_LIST_REPOSITORY, useClass: PrismaStocktakeListRepository },
  ],
})
export class StocktakeModule {}
