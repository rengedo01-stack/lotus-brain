import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CreateReplenishmentPolicyUseCase, GetReplenishmentPolicyUseCase, UpdateReplenishmentPolicyUseCase } from "./application/replenishment-policy.use-cases";
import { REPLENISHMENT_POLICY_REPOSITORY } from "./application/replenishment-policy.repository";
import { PrismaReplenishmentPolicyRepository } from "./infrastructure/prisma-replenishment-policy.repository";
import { ReplenishmentPolicyController } from "./presentation/replenishment-policy.controller";

@Module({
  imports: [PrismaModule],
  controllers: [ReplenishmentPolicyController],
  providers: [
    GetReplenishmentPolicyUseCase,
    CreateReplenishmentPolicyUseCase,
    UpdateReplenishmentPolicyUseCase,
    { provide: REPLENISHMENT_POLICY_REPOSITORY, useClass: PrismaReplenishmentPolicyRepository },
  ],
})
export class ReplenishmentPolicyModule {}
