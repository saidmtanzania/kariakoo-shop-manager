-- Phase 05: products and inventory (decisions D-002, D-003, D-007, D-013,
-- D-021). Trigram matching for product name search (NFR-1).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('COUNT_CORRECTION', 'DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'OWN_USE', 'OTHER');

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "sku" CITEXT,
    "reorder_level" DECIMAL(18,3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "conversion" DECIMAL(18,3) NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "allow_fraction" BOOLEAN NOT NULL DEFAULT false,
    "barcode" VARCHAR(64),
    "buying_price" DECIMAL(18,2),
    "retail_price" DECIMAL(18,2),
    "wholesale_price" DECIMAL(18,2),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "buying_price" DECIMAL(18,2),
    "retail_price" DECIMAL(18,2),
    "wholesale_price" DECIMAL(18,2),
    "changed_by_membership_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "shop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "average_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("shop_id","product_id","location_id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "note" VARCHAR(500),
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "balance_after" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID NOT NULL,
    "unit_name" VARCHAR(40) NOT NULL,
    "unit_quantity" DECIMAL(18,3) NOT NULL,
    "conversion" DECIMAL(18,3) NOT NULL,
    "adjustment_id" UUID,
    "reason" "AdjustmentReason",
    "note" VARCHAR(500),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_shop_id_id_key" ON "stock_locations"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_shop_id_name_key" ON "stock_locations"("shop_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_shop_id_id_key" ON "product_categories"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_shop_id_name_key" ON "product_categories"("shop_id", "name");

-- CreateIndex
CREATE INDEX "products_shop_id_name_idx" ON "products"("shop_id", "name");

-- CreateIndex
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_id_key" ON "products"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_sku_key" ON "products"("shop_id", "sku");

-- CreateIndex
CREATE INDEX "product_units_shop_id_product_id_idx" ON "product_units"("shop_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_shop_id_id_key" ON "product_units"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_product_id_name_key" ON "product_units"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_shop_id_barcode_key" ON "product_units"("shop_id", "barcode");

-- CreateIndex
CREATE INDEX "price_history_shop_id_product_unit_id_changed_at_idx" ON "price_history"("shop_id", "product_unit_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_shop_id_id_key" ON "stock_adjustments"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_shop_id_idempotency_key_key" ON "stock_adjustments"("shop_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "stock_movements_shop_id_product_id_created_at_idx" ON "stock_movements"("shop_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_shop_id_created_at_idx" ON "stock_movements"("shop_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_category_id_fkey" FOREIGN KEY ("shop_id", "category_id") REFERENCES "product_categories"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_shop_id_product_id_fkey" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_shop_id_product_unit_id_fkey" FOREIGN KEY ("shop_id", "product_unit_id") REFERENCES "product_units"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_shop_id_product_id_fkey" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_shop_id_location_id_fkey" FOREIGN KEY ("shop_id", "location_id") REFERENCES "stock_locations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_product_id_fkey" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_location_id_fkey" FOREIGN KEY ("shop_id", "location_id") REFERENCES "stock_locations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_unit_id_fkey" FOREIGN KEY ("shop_id", "unit_id") REFERENCES "product_units"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_adjustment_id_fkey" FOREIGN KEY ("shop_id", "adjustment_id") REFERENCES "stock_adjustments"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the schema language cannot express
-- ---------------------------------------------------------------------------

-- Quantities and conversions have at most 3 decimals by type (D-013);
-- prices are whole shillings (D-021) and never negative.
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_conversion_positive" CHECK ("conversion" > 0);
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_base_conversion_one" CHECK (NOT "is_base" OR "conversion" = 1);
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_prices_whole" CHECK (
  ("buying_price" IS NULL OR ("buying_price" >= 0 AND "buying_price" = trunc("buying_price")))
  AND ("retail_price" IS NULL OR ("retail_price" >= 0 AND "retail_price" = trunc("retail_price")))
  AND ("wholesale_price" IS NULL OR ("wholesale_price" >= 0 AND "wholesale_price" = trunc("wholesale_price"))));
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_prices_non_negative" CHECK (
  coalesce("buying_price", 0) >= 0 AND coalesce("retail_price", 0) >= 0 AND coalesce("wholesale_price", 0) >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_level_non_negative" CHECK ("reorder_level" IS NULL OR "reorder_level" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_average_cost_non_negative" CHECK ("average_cost" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_non_zero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("type" = 'ADJUSTMENT_OUT' AND "quantity" < 0) OR ("type" <> 'ADJUSTMENT_OUT' AND "quantity" > 0));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_values" CHECK (
  "unit_quantity" >= 0 AND "conversion" > 0 AND "unit_cost" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_reason" CHECK (
  ("type" IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')) = ("adjustment_id" IS NOT NULL AND "reason" IS NOT NULL));

-- One default location per shop (D-002). Shops created before this
-- migration get theirs here; the API creates one for every new shop.
INSERT INTO "stock_locations" ("id", "shop_id", "name", "is_default", "created_at")
SELECT gen_random_uuid(), s."id", 'Main', true, now()
FROM "shops" s;

-- A unit's conversion, base flag and product never change, so movements and
-- (later) sale lines that refer to it keep their meaning. Each product has
-- at most one base unit.
CREATE FUNCTION product_units_fixed_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product_units rows cannot be deleted; archive them';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.conversion <> OLD.conversion
      OR NEW.is_base <> OLD.is_base
      OR NEW.product_id <> OLD.product_id
      OR NEW.shop_id <> OLD.shop_id) THEN
    RAISE EXCEPTION 'product_units conversion, base flag and product cannot change';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_base AND EXISTS (
      SELECT 1 FROM product_units WHERE product_id = NEW.product_id AND is_base) THEN
    RAISE EXCEPTION 'a product has exactly one base unit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_units_fixed_fields
BEFORE INSERT OR UPDATE OR DELETE ON "product_units"
FOR EACH ROW EXECUTE FUNCTION product_units_fixed_fields();

-- The stock ledger, adjustments and price history are history: insert only.
CREATE FUNCTION reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION reject_change();

CREATE TRIGGER stock_adjustments_append_only
BEFORE UPDATE OR DELETE ON "stock_adjustments"
FOR EACH ROW EXECUTE FUNCTION reject_change();

CREATE TRIGGER price_history_append_only
BEFORE UPDATE OR DELETE ON "price_history"
FOR EACH ROW EXECUTE FUNCTION reject_change();

-- Products are archived, never deleted (they are referenced by history).
CREATE TRIGGER products_no_delete
BEFORE DELETE ON "products"
FOR EACH ROW EXECUTE FUNCTION reject_change();
