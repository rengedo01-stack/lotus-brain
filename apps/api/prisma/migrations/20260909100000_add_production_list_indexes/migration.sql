-- Production list/search uses newest-first keyset pagination. These additive
-- indexes retain all historical indexes and cover the unfiltered and exact-ID
-- filter paths without reading Product or Recipe master data.
CREATE INDEX "Production_productionDate_id_desc_idx"
ON "Production" ("productionDate" DESC, "id" DESC);

CREATE INDEX "Production_recipeId_productionDate_id_desc_idx"
ON "Production" ("recipeId", "productionDate" DESC, "id" DESC);

CREATE INDEX "Production_outputProductIdSnapshot_productionDate_id_desc_idx"
ON "Production" ("outputProductIdSnapshot", "productionDate" DESC, "id" DESC);
