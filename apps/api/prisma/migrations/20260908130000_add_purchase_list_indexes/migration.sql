-- Purchase list/search uses newest-first keyset pagination. These additive
-- indexes preserve the existing supplier/status indexes for filtered paths.
CREATE INDEX "Purchase_purchaseDate_id_desc_idx"
ON "Purchase" ("purchaseDate" DESC, "id" DESC);

CREATE INDEX "Purchase_documentNumber_purchaseDate_id_desc_idx"
ON "Purchase" ("documentNumber", "purchaseDate" DESC, "id" DESC);
