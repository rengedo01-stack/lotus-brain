ALTER TABLE "Inventory"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_version_positive_check" CHECK ("version" > 0);
