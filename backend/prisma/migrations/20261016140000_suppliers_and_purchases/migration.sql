-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierEntryType" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'PURCHASE_CANCELLED', 'PAYMENT', 'PAYMENT_REVERSED');

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_REVERSAL';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "purchase_id" UUID;

-- CreateTable
CREATE TABLE "shop_counters" (
    "shop_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "shop_counters_pkey" PRIMARY KEY ("shop_id","key")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "phone" VARCHAR(30),
    "address" VARCHAR(200),
    "note" VARCHAR(500),
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "supplier_reference" VARCHAR(60),
    "note" VARCHAR(500),
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "extra_costs" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "received_by_membership_id" UUID,
    "received_at" TIMESTAMPTZ(3),
    "cancelled_by_membership_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "unit_name" VARCHAR(40) NOT NULL,
    "conversion" DECIMAL(18,3) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "base_quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "allocated_extra" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "landed_cost_per_base" DECIMAL(18,4),

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_charges" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "description" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "purchase_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "SupplierPaymentMethod" NOT NULL,
    "reference" VARCHAR(60),
    "note" VARCHAR(500),
    "purchase_id" UUID,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_membership_id" UUID,
    "reverse_reason" VARCHAR(500),

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ledger_entries" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "type" "SupplierEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "purchase_id" UUID,
    "payment_id" UUID,
    "note" VARCHAR(500),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_shop_id_id_key" ON "suppliers"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_shop_id_name_key" ON "suppliers"("shop_id", "name");

-- CreateIndex
CREATE INDEX "purchases_shop_id_status_created_at_idx" ON "purchases"("shop_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "purchases_shop_id_supplier_id_created_at_idx" ON "purchases"("shop_id", "supplier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_shop_id_id_key" ON "purchases"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_shop_id_number_key" ON "purchases"("shop_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_shop_id_idempotency_key_key" ON "purchases"("shop_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "purchase_lines_shop_id_product_id_idx" ON "purchase_lines"("shop_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lines_purchase_id_line_no_key" ON "purchase_lines"("purchase_id", "line_no");

-- CreateIndex
CREATE INDEX "purchase_charges_purchase_id_idx" ON "purchase_charges"("purchase_id");

-- CreateIndex
CREATE INDEX "supplier_payments_shop_id_supplier_id_created_at_idx" ON "supplier_payments"("shop_id", "supplier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_shop_id_id_key" ON "supplier_payments"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_shop_id_idempotency_key_key" ON "supplier_payments"("shop_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_shop_id_supplier_id_created_at_idx" ON "supplier_ledger_entries"("shop_id", "supplier_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_purchase_id_fkey" FOREIGN KEY ("shop_id", "purchase_id") REFERENCES "purchases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_counters" ADD CONSTRAINT "shop_counters_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_shop_id_supplier_id_fkey" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_shop_id_purchase_id_fkey" FOREIGN KEY ("shop_id", "purchase_id") REFERENCES "purchases"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_shop_id_product_id_fkey" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_shop_id_unit_id_fkey" FOREIGN KEY ("shop_id", "unit_id") REFERENCES "product_units"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_charges" ADD CONSTRAINT "purchase_charges_shop_id_purchase_id_fkey" FOREIGN KEY ("shop_id", "purchase_id") REFERENCES "purchases"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_shop_id_supplier_id_fkey" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_shop_id_purchase_id_fkey" FOREIGN KEY ("shop_id", "purchase_id") REFERENCES "purchases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_shop_id_supplier_id_fkey" FOREIGN KEY ("shop_id", "supplier_id") REFERENCES "suppliers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_shop_id_purchase_id_fkey" FOREIGN KEY ("shop_id", "purchase_id") REFERENCES "purchases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_shop_id_payment_id_fkey" FOREIGN KEY ("shop_id", "payment_id") REFERENCES "supplier_payments"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules the database enforces (Phase 06). Enum values added above cannot be
-- used as literals in this transaction, so the checks compare type::text.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_direction";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("type"::text IN ('ADJUSTMENT_OUT', 'PURCHASE_REVERSAL') AND "quantity" < 0)
  OR ("type"::text NOT IN ('ADJUSTMENT_OUT', 'PURCHASE_REVERSAL') AND "quantity" > 0));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_ref" CHECK (
  ("type"::text IN ('PURCHASE_RECEIPT', 'PURCHASE_REVERSAL')) = ("purchase_id" IS NOT NULL));

ALTER TABLE "shop_counters" ADD CONSTRAINT "shop_counters_value_positive" CHECK ("value" > 0);

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_number_positive" CHECK ("number" > 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts" CHECK (
  "subtotal" >= 0 AND "extra_costs" >= 0 AND "total" = "subtotal" + "extra_costs"
  AND "subtotal" = trunc("subtotal") AND "extra_costs" = trunc("extra_costs"));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_fields" CHECK (
  ("status" = 'DRAFT' AND "received_at" IS NULL AND "cancelled_at" IS NULL)
  OR ("status" = 'RECEIVED' AND "received_at" IS NOT NULL AND "received_by_membership_id" IS NOT NULL AND "cancelled_at" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_membership_id" IS NOT NULL));

ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_values" CHECK (
  "quantity" > 0 AND "base_quantity" > 0 AND "conversion" > 0
  AND "unit_cost" >= 0 AND "unit_cost" = trunc("unit_cost")
  AND "line_total" >= 0 AND "line_total" = trunc("line_total")
  AND "allocated_extra" >= 0 AND "allocated_extra" = trunc("allocated_extra")
  AND ("landed_cost_per_base" IS NULL OR "landed_cost_per_base" >= 0));
ALTER TABLE "purchase_charges" ADD CONSTRAINT "purchase_charges_amount" CHECK (
  "amount" > 0 AND "amount" = trunc("amount"));

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount" CHECK (
  "amount" > 0 AND "amount" = trunc("amount"));
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversal_fields" CHECK (
  ("reversed_at" IS NULL) = ("reversed_by_membership_id" IS NULL));

ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_amount" CHECK (
  "amount" <> 0 AND "amount" = trunc("amount"));
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_direction" CHECK (
  ("type" IN ('OPENING_BALANCE', 'PURCHASE', 'PAYMENT_REVERSED') AND "amount" > 0)
  OR ("type" IN ('PURCHASE_CANCELLED', 'PAYMENT') AND "amount" < 0));
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_refs" CHECK (
  ("type" IN ('PURCHASE', 'PURCHASE_CANCELLED')) = ("purchase_id" IS NOT NULL AND "payment_id" IS NULL)
  AND ("type" IN ('PAYMENT', 'PAYMENT_REVERSED')) = ("payment_id" IS NOT NULL));

-- The supplier ledger is history: insert only.
CREATE TRIGGER supplier_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON "supplier_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION reject_change();

CREATE TRIGGER suppliers_no_delete
BEFORE DELETE ON "suppliers"
FOR EACH ROW EXECUTE FUNCTION reject_change();

-- A payment is never edited or deleted; it can only be marked reversed, once.
CREATE FUNCTION supplier_payments_reverse_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier_payments rows cannot be deleted; reverse them';
  END IF;
  IF OLD.reversed_at IS NOT NULL
      OR NEW.reversed_at IS NULL
      OR (to_jsonb(NEW) - 'reversed_at' - 'reversed_by_membership_id' - 'reverse_reason')
         IS DISTINCT FROM
         (to_jsonb(OLD) - 'reversed_at' - 'reversed_by_membership_id' - 'reverse_reason') THEN
    RAISE EXCEPTION 'a supplier payment can only be marked reversed, once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_payments_reverse_only
BEFORE UPDATE OR DELETE ON "supplier_payments"
FOR EACH ROW EXECUTE FUNCTION supplier_payments_reverse_only();

-- Purchases are never deleted. A draft can change freely; a received
-- purchase can only become cancelled; a cancelled one never changes.
CREATE FUNCTION purchases_status_flow() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchases cannot be deleted; cancel them';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'RECEIVED' AND NEW.status = 'CANCELLED'
      AND (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancelled_by_membership_id'
           - 'cancel_reason' - 'updated_at')
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancelled_by_membership_id'
           - 'cancel_reason' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a % purchase cannot be changed', lower(OLD.status::text);
END;
$$;

CREATE TRIGGER purchases_status_flow
BEFORE UPDATE OR DELETE ON "purchases"
FOR EACH ROW EXECUTE FUNCTION purchases_status_flow();

-- Lines and extra costs change only while their purchase is a draft.
CREATE FUNCTION purchase_parts_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM purchases
  WHERE id = COALESCE(NEW.purchase_id, OLD.purchase_id);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '% of a % purchase cannot change', TG_TABLE_NAME, lower(parent_status);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER purchase_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON "purchase_lines"
FOR EACH ROW EXECUTE FUNCTION purchase_parts_draft_only();

CREATE TRIGGER purchase_charges_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON "purchase_charges"
FOR EACH ROW EXECUTE FUNCTION purchase_parts_draft_only();
