-- Distinguish resale inventory from primary developer inventory.
ALTER TABLE "Unit" ADD COLUMN "isResale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImportSheet" ADD COLUMN "defaultIsResale" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Unit_isResale_status_idx" ON "Unit"("isResale", "status");
