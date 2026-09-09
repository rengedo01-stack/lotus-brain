-- Supply-context aggregation starts with unposted Purchase rows and joins
-- their item quantities for a bounded Inventory page. This preserves the
-- existing product lookup index while preventing a status-filtered purchase
-- scan from filtering product IDs after each item lookup.
CREATE INDEX "PurchaseItem_purchaseId_productId_idx"
ON "PurchaseItem" ("purchaseId", "productId");
