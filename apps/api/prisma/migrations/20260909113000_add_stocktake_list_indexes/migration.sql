-- Stocktake list/search uses newest-created-first keyset pagination. These
-- additive indexes retain every existing index and never join Product data.
CREATE INDEX "Stocktake_createdAt_id_desc_idx"
ON "Stocktake" ("createdAt" DESC, "id" DESC);

CREATE INDEX "Stocktake_status_createdAt_id_desc_idx"
ON "Stocktake" ("status", "createdAt" DESC, "id" DESC);
