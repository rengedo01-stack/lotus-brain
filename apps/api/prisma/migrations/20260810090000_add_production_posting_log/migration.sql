CREATE TYPE "ProductionLogEventType" AS ENUM ('STATUS_CHANGED');

CREATE TABLE "ProductionLog" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "eventType" "ProductionLogEventType" NOT NULL,
    "fromStatus" "ProductionStatus",
    "toStatus" "ProductionStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionLog_productionId_createdAt_idx" ON "ProductionLog"("productionId", "createdAt");
CREATE INDEX "ProductionLog_toStatus_createdAt_idx" ON "ProductionLog"("toStatus", "createdAt");

ALTER TABLE "ProductionLog"
ADD CONSTRAINT "ProductionLog_productionId_fkey"
FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
